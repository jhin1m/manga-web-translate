/** Every `${VAR}` in docker-compose.yml must have a row in the table the runner uses to carry values over. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPOSE_VARS } from "../../src/updater/compose-vars.ts";
import { composeEnv } from "../../src/updater/runner-plan.ts";

const compose = readFileSync(new URL("../../../../docker-compose.yml", import.meta.url), "utf8");
// Comment lines may mention `${...}`; only real interpolations count.
const body = compose
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");
const used = [...new Set([...body.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] as string))].sort();

describe("compose variables", () => {
  it("finds the variables the compose file interpolates", () => {
    expect(used).toContain("MTL_TAG");
    expect(used).toContain("MTL_UPDATER");
  });

  it("every interpolated variable is in the table", () => {
    const missing = used.filter((v) => !(v in COMPOSE_VARS));
    expect(missing, `add these to compose-vars.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("the table has no stale rows", () => {
    const stale = Object.keys(COMPOSE_VARS).filter((v) => !used.includes(v));
    expect(stale, `no longer used by docker-compose.yml: ${stale.join(", ")}`).toEqual([]);
  });

  it("restored values reach the compose environment, fixed ones override", () => {
    const source = Object.fromEntries(Object.entries(COMPOSE_VARS).map(([k]) => [k, `v-${k}`]));
    const env = composeEnv(source, "latest");
    for (const [name, src] of Object.entries(COMPOSE_VARS)) {
      if (src.action === "restore") expect(env[name]).toBe(`v-${name}`);
      if (src.action === "fixed") expect(env[name]).toBe(src.value);
      if (src.action === "target") expect(env[name]).toBe("latest");
      if (src.action === "drop") expect(name in env).toBe(false);
    }
  });
});
