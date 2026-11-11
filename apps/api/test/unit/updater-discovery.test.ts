/** Discovery of project, daemon-side directory, version, pin and restored compose variables from `docker inspect` fixtures. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeProject, discover, type InspectContainer, LABEL } from "../../src/updater/discovery.ts";

const NAMES = ["linux", "orbstack", "docker-desktop-mac", "windows-wsl2"] as const;
type Fixture = { platform: string; containers: InspectContainer[] };

const load = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/docker-inspect-${name}.json`, import.meta.url), "utf8")) as Fixture;

const service = (cs: InspectContainer[], name: string) => {
  const c = cs.find((x) => x.Config.Labels?.[LABEL.service] === name);
  if (!c) throw new Error(`fixture has no ${name}`);
  return c;
};

/** Fresh copy of a fixture with `fn` applied; returns the discover() input. */
function build(name: string, fn: (cs: InspectContainer[]) => void = () => {}) {
  const cs = structuredClone(load(name).containers);
  fn(cs);
  return { self: service(cs, "updater"), containers: cs };
}

const EXPECTED_DIR: Record<(typeof NAMES)[number], string> = {
  linux: "/home/me/mtl",
  orbstack: "/Users/me/mtl",
  "docker-desktop-mac": "/host_mnt/Users/me/mtl",
  "windows-wsl2": "/run/desktop/mnt/host/c/Users/me/mtl",
};

describe("discover on recorded layouts", () => {
  for (const name of NAMES) {
    it(`${name}: project, daemon directory, version, pin and restored variables`, () => {
      const r = discover(build(name));
      if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
      expect(r.info.project).toBe("mtl-local");
      expect(r.info.daemonDir).toBe(EXPECTED_DIR[name]);
      expect(r.info.current).toBe("0.2.0");
      expect(r.info.pinnedTag).toBeNull();
      expect(r.info.socketSource).toBe("/var/run/docker.sock");
      expect(r.info.vars).toEqual({
        MTL_PORT: "9090",
        MTL_ALLOWED_HOSTS: "host.docker.internal",
        MTL_UPDATE_CHECK: "",
        MTL_UPDATE_TARGET: "",
        MTL_WORKERS: "1",
        MTL_THREADS: "4",
        MTL_DOCKER_SOCK: "",
      });
      expect(r.info.binds.postgres).toEqual({ "/var/lib/postgresql/data": `${EXPECTED_DIR[name]}/data/postgres` });
      expect(r.info.binds.updater?.["/var/run/docker.sock"]).toBeUndefined();
    });
  }

  it("uses the configured socket string, not the mount source", () => {
    const input = build("orbstack", (cs) => {
      const u = service(cs, "updater");
      u.Config.Env = [
        ...(u.Config.Env ?? []).filter((e) => !e.startsWith("MTL_DOCKER_SOCK=")),
        "MTL_DOCKER_SOCK=/run/user/1000/docker.sock",
      ];
    });
    const r = discover(input);
    expect(r.ok && r.info.socketSource).toBe("/run/user/1000/docker.sock");
  });
});

describe("discover refusals", () => {
  const reason = (name: string, fn: (cs: InspectContainer[]) => void) => {
    const r = discover(build(name, fn));
    return r.ok ? "ok" : r.reason;
  };
  const setMount = (c: InspectContainer, dest: string, source: string) => {
    for (const m of c.Mounts ?? []) if (m.Destination === dest) m.Source = source;
  };
  const setLabel = (cs: InspectContainer[], key: string, value: string) => {
    for (const c of cs) (c.Config.Labels as Record<string, string>)[key] = value;
  };

  it("no compose project label on this container", () => {
    const input = build("orbstack");
    delete (input.self.Config.Labels as Record<string, string>)[LABEL.project];
    const r = discover(input);
    expect(!r.ok && r.reason).toBe("project_not_found");
  });

  it("missing app or postgres container", () => {
    expect(reason("orbstack", (cs) => cs.splice(cs.indexOf(service(cs, "postgres")), 1))).toBe("project_not_found");
    expect(reason("orbstack", (cs) => cs.splice(cs.indexOf(service(cs, "app")), 1))).toBe("project_not_found");
  });

  it("two config files or an override file -> custom_compose", () => {
    expect(
      reason("orbstack", (cs) =>
        setLabel(cs, LABEL.configFiles, "/Users/me/mtl/docker-compose.yml,/Users/me/mtl/docker-compose.override.yml"),
      ),
    ).toBe("custom_compose");
    expect(
      reason("orbstack", (cs) => setLabel(cs, LABEL.configFiles, "/Users/me/mtl/docker-compose.override.yml")),
    ).toBe("custom_compose");
    expect(reason("orbstack", (cs) => setLabel(cs, LABEL.configFiles, "/elsewhere/docker-compose.yml"))).toBe(
      "custom_compose",
    );
  });

  it("data mounts that do not share a root -> path_mismatch", () => {
    expect(
      reason("orbstack", (cs) =>
        setMount(service(cs, "postgres"), "/var/lib/postgresql/data", "/Users/other/data/postgres"),
      ),
    ).toBe("path_mismatch");
    expect(reason("orbstack", (cs) => setMount(service(cs, "app"), "/data/files", "/Users/me/mtl/files"))).toBe(
      "path_mismatch",
    );
  });

  it("C:\\ sources are refused in this release", () => {
    expect(
      reason("windows-wsl2", (cs) => {
        setMount(service(cs, "app"), "/data/files", "C:\\Users\\me\\mtl\\data\\files");
        setMount(service(cs, "postgres"), "/var/lib/postgresql/data", "C:\\Users\\me\\mtl\\data\\postgres");
      }),
    ).toBe("path_mismatch");
  });

  it("Docker Desktop temporary proxy paths are refused", () => {
    const tmp = "/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Ubuntu/abc";
    expect(
      reason("windows-wsl2", (cs) => {
        setMount(service(cs, "app"), "/data/files", `${tmp}/data/files`);
        setMount(service(cs, "postgres"), "/var/lib/postgresql/data", `${tmp}/data/postgres`);
      }),
    ).toBe("path_mismatch");
  });

  it("working_dir label must be a suffix of the daemon directory", () => {
    expect(
      reason("orbstack", (cs) => {
        setLabel(cs, LABEL.workingDir, "/Users/me/other");
        setLabel(cs, LABEL.configFiles, "/Users/me/other/docker-compose.yml");
      }),
    ).toBe("path_mismatch");
    // Linux paths are case-sensitive.
    expect(
      reason("linux", (cs) => {
        setLabel(cs, LABEL.workingDir, "/home/ME/mtl");
        setLabel(cs, LABEL.configFiles, "/home/ME/mtl/docker-compose.yml");
      }),
    ).toBe("path_mismatch");
  });

  it("Windows labels compare case-insensitively and with the drive letter", () => {
    const lower = (cs: InspectContainer[]) => {
      setLabel(cs, LABEL.workingDir, "c:\\users\\ME\\MTL");
      setLabel(cs, LABEL.configFiles, "c:\\users\\ME\\MTL\\docker-compose.yml");
    };
    expect(reason("windows-wsl2", lower)).toBe("ok");
    const wrongDrive = (cs: InspectContainer[]) => {
      setLabel(cs, LABEL.workingDir, "D:\\Users\\me\\mtl");
      setLabel(cs, LABEL.configFiles, "D:\\Users\\me\\mtl\\docker-compose.yml");
    };
    expect(reason("windows-wsl2", wrongDrive)).toBe("path_mismatch");
  });

  it("app image from another repository -> image_not_allowed; tagged image is a pin", () => {
    expect(reason("orbstack", (cs) => (service(cs, "app").Config.Image = "ghcr.io/other/mtl:latest"))).toBe(
      "image_not_allowed",
    );
    const r = discover(build("orbstack", (cs) => (service(cs, "app").Config.Image = "ghcr.io/jhin1m/mtl:0.2.0")));
    expect(r.ok && r.info.pinnedTag).toBe("0.2.0");
  });

  it("MTL_VERSION=dev or unset -> dev_build", () => {
    const setVersion = (v: string | null) => (cs: InspectContainer[]) => {
      const app = service(cs, "app");
      app.Config.Env = (app.Config.Env ?? []).filter((e) => !e.startsWith("MTL_VERSION="));
      if (v !== null) app.Config.Env.push(`MTL_VERSION=${v}`);
    };
    expect(reason("orbstack", setVersion("dev"))).toBe("dev_build");
    expect(reason("orbstack", setVersion(null))).toBe("dev_build");
  });
});

describe("restored variables", () => {
  it("zero worker containers -> MTL_WORKERS=0 and no MTL_THREADS", () => {
    const input = build("orbstack", (cs) => cs.splice(cs.indexOf(service(cs, "worker")), 1));
    const r = discover(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.info.vars.MTL_WORKERS).toBe("0");
      expect(r.info.vars.MTL_THREADS).toBeUndefined();
    }
  });

  it("two workers are counted", () => {
    const input = build("orbstack", (cs) => {
      const w = structuredClone(service(cs, "worker"));
      w.Id = "w2";
      cs.push(w);
    });
    const r = discover(input);
    expect(r.ok && r.info.vars.MTL_WORKERS).toBe("2");
  });

  it("analyzeProject ignores containers of other projects", () => {
    const { containers } = build("orbstack");
    const stranger = structuredClone(service(containers, "app"));
    (stranger.Config.Labels as Record<string, string>)[LABEL.project] = "other";
    const r = analyzeProject("mtl-local", [...containers, stranger]);
    expect(r.ok).toBe(true);
  });
});
