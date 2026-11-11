# Docker Desktop paths / compose runner research (2026-11-11)

Method: web docs + issues, plus LOCAL probes on macOS (OrbStack, Engine 29.4.0, API 1.54, min 1.40, Compose v5.1.2). "Local-verified" = I ran it. No Windows machine available -> all Windows claims are web-only/anecdotal.
Note: Compose is now v5.x (v5.7.1 latest release); "compose v2" binary = same codebase, versions renumbered. Plugin binary in docker:cli is v5.7.0.

## TL;DR / recommendation
- Core plan (identical-path bind of daemon-side Source into runner + `--project-directory`) is **proven on Linux-style daemons (OrbStack, local-verified)**. **Unproven on Docker Desktop Windows**: evidence shows `Mounts[].Source` form is inconsistent (`C:\...` for `--mount`, `/run/desktop/mnt/host/c/...` for `-v`). Treat Windows as "must test".
- Safer variant: do NOT strip/convert. Take the Source string exactly as the daemon reports it for the app container's mount, and pass the same string as the bind source in the runner's `HostConfig.Mounts/Binds` (daemon accepted it once, so it should accept it back). Add a runtime self-check in runner (`test -f <path>/docker-compose.yml`) and fail with a clear message, never fall back to guessing.
- Pin Engine API path to `/v1.44` (not unversioned) - see Q9.
- Don't use Watchtower (archived).

## Q1 Docker Desktop Windows (WSL2 / Hyper-V)
| Finding | Conf | Source | Test on Win? |
|---|---|---|---|
| `-v C:\Utils\x:/c` shows `Mounts[].Source` = `/run/desktop/mnt/host/c/Utils/...` (Linux-side proxy path) in a forum report | med | https://forums.docker.com/t/how-to-use-mapping-volumes-host-w10-container-linux/147903 | yes |
| Same thread: a `--mount` run showed Source `C:\\Utils\\...` (Windows string kept) and `Binds: null` -> Source format NOT uniform across creation styles/versions. Compose short-syntax uses `HostConfig.Binds` (local-verified: Binds=`/tmp/..:/data:rw`), so which form lands in Source for compose-created containers is unknown | low | same | **yes (critical)** |
| `HostConfig.Binds` keeps the client-sent string (Linux: local-verified identical to Source). Whether compose on Windows sends `C:\...` or converted path to Binds: unverified | low | local probe; no Win evidence | yes |
| bind Source in inspect "correct", volume Mountpoint is daemon-internal (by design, maintainer: daemon reports its own view) | high | https://github.com/docker/for-win/issues/6875 | no |
| Nested bind from inside container with Windows-ish source failed: "bind source path does not exist: /C/Users/.../test.yml" on WSL2 backend (DD 2.3.0.4, 2020, unanswered; worked on Hyper-V). Old, but warns that source-path form matters | low | https://forums.docker.com/t/bind-source-path-does-not-exist-when-creating-bind-mount-from-within-a-container/97785 | yes |
| Docker Desktop daemon inside Linux VM; Desktop "transparently handles" host bind mounts; temp proxy paths `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/...` are ephemeral (vanish after restart) -> do NOT persist such Sources; re-read at each update click | med | https://docs.docker.com/engine/storage/bind-mounts/ ; https://yomotherboard.com/?p=485934 (weak) | yes |
| `/mnt/c` style paths also reported to work on recent DD; `/run/desktop/mnt/host/c` once reported as plain dir (Nextcloud AIO thread, anecdotal) | low | https://help.nextcloud.com/t/your-guide-to-nextcloud-all-in-one-on-windows-10-11/153416/2 | yes |
| Whether a client in a container creating a container with source `/run/desktop/mnt/host/c/Users/me/mtl/data/files` mounts the same Windows folder | **unverified** (plausible: it is the VM path of the C: mount) | no authoritative doc found | **yes** |
| Spaces / Vietnamese diacritics / D: / `\\wsl$\...` project folders | **unverified**; no issue found specific to these. Known generic: paths under WSL distro are Linux paths (best practice is keeping files in WSL FS) https://docs.docker.com/desktop/features/wsl/best-practices/ . A `\\wsl$\` project dir may report Source as a plain Linux path (`/mnt/wsl/...` or distro path) - guess | low | - | **yes** |

## Q2 Docker Desktop Mac / OrbStack
| Finding | Conf | Source | Test? |
|---|---|---|---|
| OrbStack: Source = real macOS path (`/tmp/ct4a/data`), runner with identical path bind + `-p ct4 --project-directory` + standalone `docker-compose` binary recreated nothing/created the project correctly; Mounts Source identical to host path. **Local-verified** | high | local probe | no |
| Docker Desktop Mac: shared dirs default `/Users /Volumes /private /tmp /var/folders`; DD translates host path internally. Error text in a report shows the daemon-side path `/host_mnt/Users/...` appears in daemon errors; inspect Source form on DD Mac (`/Users/..` vs `/host_mnt/Users/..`) **unverified** | low | https://docs.docker.com/desktop/settings-and-maintenance/settings/ ; https://discuss.localstack.cloud/t/error-while-creating-mount-source-path-host-mnt-users-rainy-days-docker-run-docker-sock/740 | yes (Mac DD) |
| Folders outside shared dirs -> "Mounts denied" for runner too (app container would fail already) | high | settings page above | no |

## Q3 docker.sock on Desktop
| Finding | Conf | Source | Test? |
|---|---|---|---|
| Desktop: `-v /var/run/docker.sock:/var/run/docker.sock` is special-cased; socket mounted is the one in the Desktop VM, not host (Docs say use `/var/run/docker.sock.raw` for extensions; implies plain path semantics are VM-side) | med | https://docs.docker.com/desktop/extensions-sdk/guides/use-docker-socket-from-backend/ | yes |
| Windows: mount works via VM socket (common practice: portainer/traefik on DD Win), old compose bug (2018, "not a valid Windows path") fixed in compose 1.23/Docker 18.09 | med | https://github.com/docker/for-win/issues/1829 | yes |
| Mac setting "Allow the default Docker socket to be used" (needs password) only creates host `/var/run/docker.sock` for host clients; container-side mount still works without it (inferred; the LocalStack thread shows failures when user lacked admin: mkdir `/host_mnt/Users/x/.docker/run/docker.sock`). Real risk: Mac install without admin | med/low | settings page; localstack thread | yes (Mac) |
| Enhanced Container Isolation: "By default, ECI blocks bind mounting the Docker Engine socket"; admin can allow per image. ECI is a Business-tier hardened feature, off by default (default state not stated on page) | high (block) / med (off by default) | https://docs.docker.com/desktop/hardened-desktop/enhanced-container-isolation/ | no |
| Mitigation: updater should detect failure to reach socket and show "Docker Desktop settings block socket (ECI)" message | - | - | - |

## Q4 Compose labels, project identity, hash
| Finding | Conf | Source | Test? |
|---|---|---|---|
| Names: `com.docker.compose.project.working_dir` ("absolute path to project working dir"), `com.docker.compose.project.config_files` ("absolute path to config files"), `com.docker.compose.config-hash`, `com.docker.compose.project` | high | https://raw.githubusercontent.com/docker/compose/main/pkg/api/labels.go | no |
| config_files = comma-joined for multiple -f (local-verified: `/tmp/ct7/a.yml,/tmp/ct7/b.yml`). Single file: `/tmp/ct1/docker-compose.yml` | high | local probe | no |
| From Windows PowerShell: labels hold client-native paths, i.e. `C:\Users\me\mtl` / `C:\Users\me\mtl\docker-compose.yml` (expected from Go `filepath.Abs` on Windows; **no doc/issue found confirming**). A Linux runner cannot use these -> your plan of deriving dir from Mounts is right; labels only as hint/diagnostics. Do not feed labels to Linux compose as-is | low | inference | **yes** |
| Same project = same `com.docker.compose.project` name (+ `-p mtl-local`); Linux client with different abs paths adopts containers by name label. **Local-verified**: `up` from /tmp/ct4a then /tmp/ct4b (same name) acted on same container | high | local probe | no |
| Different bind source path -> config-hash differs -> container **Recreated** (local-verified: moved dir -> "Container ct4-s-1 Recreated"; working_dir label updated). So hash covers resolved bind source. Consequence: if runner's path string differs from the string the Windows client used (e.g. `C:\..` vs `/run/desktop/...`), first in-app update recreates app+db containers once (Binds change). Postgres data is a bind, so data is safe, but expect a one-time restart/recreate; also user's later PowerShell `docker compose up` will recreate again (flip-flop) | high (mechanism) / med (Win impact) | local probe; compose `internal/confighash` (hash over service config) | yes |
| Hash ignores `scale/replicas` since v2.24.0 (all services recreated once on that upgrade) | med | https://github.com/ddev/ddev/pull/5745 (via search summary) | no |

## Q5 `deploy.replicas: ${VAR:-1}` = 0
| Finding | Conf | Source | Test? |
|---|---|---|---|
| `config --format json` shows `deploy.replicas: 0` after interpolation; `up -d --wait` brings up only other service; the 0-replica service creates NO container and its bind sources (`./data/b`, even a non-existent `/var/run/nonexistent-dir/docker.sock` parent) were NOT created on host. **Local-verified on Compose v5.1.2** | high (v5.1.2) | local probe | no |
| Min compose version: not pinned by docs. Replicas honored by `up` in v2 (forum workaround for e2e services; issue #7770 shows replicas>1 honored); v2.24.0 changed hashing. Recommend requiring >= 2.24 (practically: bundle v5.x binary, which you control for runner; user's own CLI is a separate concern) | low-med | https://forums.docker.com/t/is-there-a-way-to-make-run-override-scale-replica/119646 ; https://github.com/docker/compose/issues/7770 | maybe (user's old Compose on Win) |
| Caveat: `docker compose run`/`--scale` interplay; `ps -a` won't list the service; `depends_on` on a 0-replica service by others may fail - keep updater un-depended-on | med | forum above | no |
| Alternative that is more robust: `profiles: [updater]` + `COMPOSE_PROFILES` - skips service entirely with no replicas semantics (documented, longstanding) | med | https://docs.docker.com/compose/how-tos/profiles/ (not fetched; known docs) | no |

## Q6 Missing socket bind source
| Finding | Conf | Source | Test? |
|---|---|---|---|
| Short syntax `-v`/compose short: daemon creates missing host path **as a directory** ("always created as a directory"); `--mount`/long syntax errors "bind source path does not exist". **Local-verified**: compose short syntax created `nope.sock` as an empty dir; `up -d` succeeded (container then has a dir at /var/run/docker.sock, useless) | high | https://docs.docker.com/engine/storage/bind-mounts/ ; local probe | no |
| Rootless Linux: `/var/run/docker.sock` absent; daemon (running as user) tries mkdir under root-owned `/var/run` -> likely "permission denied"/mkdir error and `up -d` fails for that service (and compose aborts creating the rest). **Unverified** (analogous real error seen on Mac no-admin: "error while creating mount source path ... mkdir") | low-med | localstack thread above | Linux-rootless test |
| Fix: updater service via `profiles`/replicas 0 by default, enable only when `/var/run/docker.sock` exists and not rootless; or use long syntax `type: bind, bind.create_host_path: false` so missing file gives clean error (compose spec option) | med | compose-spec | no |

## Q7 Standalone compose binary
| Finding | Conf | Source | Test? |
|---|---|---|---|
| Official standalone install is "legacy/back-compat only" but supported: release asset `docker-compose-linux-x86_64`, `-linux-aarch64`, also armv6/v7, ppc64le, s390x, riscv64, windows; has `.sha256`, sigstore, sbom | high | https://docs.docker.com/compose/install/standalone/ ; GitHub release API (local fetch v5.7.1) | no |
| `docker/compose-bin` image exists, multi-arch (linux amd64/arm64/arm/ppc64le/riscv64/s390x, plus darwin/windows). **Local-verified** manifest. Use `COPY --from=docker/compose-bin:vX /docker-compose /usr/local/bin/` (path in image not verified by me - check) | med-high | local `docker manifest inspect docker/compose-bin:latest` | no |
| `docker:cli` image has `/usr/local/libexec/docker/cli-plugins/docker-compose` (v5.7.0) and `docker-buildx`. **Local-verified**; calling it directly as entrypoint with args `-p .. up -d` works (local-verified end-to-end on arm64) | high | local probe | no |
| Works without docker CLI: binary talks to socket itself; my end-to-end test used docker:cli image, so "no docker CLI present" itself unproven but compose is a Go client and only shells out for buildx/credential helpers (pull of public/private images needing `docker-credential-*` would fail without them) | med | inference | maybe |
| Pull of private registry / `~/.docker/config.json` creds: runner has none unless mounted | high | - | - |

## Q8 `config --format json`, `--wait`
| Finding | Conf | Source | Test? |
|---|---|---|---|
| `docker compose config --format json` emits per-service `volumes[]` with `type: bind`, absolute `source`, `target` (local-verified, e.g. `/tmp/ct1/data/files`). Relative paths resolved against project dir (from `--project-directory`) | high | local probe | no |
| `up -d --wait --wait-timeout N`: waits for containers healthy (local-verified: "Container ct4a Waiting -> Healthy"). Compose docs: `--wait` waits for services to be running/healthy; services w/o healthcheck count as ready when running (documented behavior; I did not test a no-healthcheck case; a service that exits fails the wait) | med-high | https://docs.docker.com/reference/cli/docker/compose/up/ (not fetched) ; compose source up.go has WaitTimeout handling | no |
| `--wait` implies `-d`; `--wait-timeout` bounds every dependency wait too | high | compose source (up.go comments) | no |

## Q9 Engine API versioning
| Finding | Conf | Source | Test? |
|---|---|---|---|
| Unversioned paths work (local-verified `GET /containers/json` -> 200 on 29.4.0) and resolve to daemon's latest API. Official docs show only versioned paths and say "specify the version as the first part of the URL"; negotiation is client-side best-effort | high (works) / med (guaranteed) | https://docs.docker.com/reference/api/engine/ | no |
| Engine 29.0.0 raised min API to **1.44** (Docker 25+). 29.3.0 lowered min back to **1.40**. So at 29.0-29.2 clients <1.44 got rejected | high | https://docs.docker.com/engine/release-notes/29/ | no |
| Recommendation: use `/v1.44` prefix (works on every 29.x, Docker 25+; Desktop users on <25 are EOL) or do `GET /version` and use `min(ApiVersion, 1.4x)`. Unversioned is OK but silently follows newest schema changes; pinned is more predictable. YAGNI: pin v1.44 | med | above | no |

## Q10 Watchtower
| Finding | Conf | Source | Test? |
|---|---|---|---|
| containrrr/watchtower **archived Dec 17 2025**, README "no longer maintained" | high | https://github.com/containrrr/watchtower | no |
| Upstream: no real `depends_on` ordering; uses own `com.centurylinklabs.watchtower.depends-on` label; never fetches new compose files (only pulls image + recreates container with old config, so no new env/volume/schema changes) | med | https://github.com/containrrr/watchtower/blob/dca45f50cb0d25ddce27f9ff5424d4fcc151f848/docs/linked-containers.md ; https://github.com/containrrr/watchtower/issues/595 | no |
| Forks: nicholas-fedor/watchtower (most cited, v1.13.0 added compose `depends_on` support; Nextcloud reportedly adopted), beatkind/watchtower, openserbia/watchtower. Docker 29 API break fixed fast in fork | med | https://linuxiac.com/docker-update-tool-watchtower-reaches-end-of-maintenance/ ; https://newreleases.io/project/github/nicholas-fedor/watchtower/release/v1.13.0 ; https://openserbia.github.io/watchtower/why-fork/ | no |
| Verdict: unfit - cannot apply compose file changes (migrations needing new env/volumes/services), single-maintainer fork risk. Keep custom updater | - | - | - |

## Limitations
- No Windows/DD-Mac/Hyper-V/rootless-Linux machine; those rows are web/inference only. Web search summaries were thin; several claims rely on 1-2 forum posts (low conf).
- Did not read Compose `up` docs page or compose-bin image internals directly.

## Items provable ONLY on a real Windows machine (DD WSL2 backend; repeat key ones on Hyper-V)
1. `docker inspect` of compose-created (`docker compose up` from PowerShell) app container: exact `Mounts[].Source` and `HostConfig.Binds` strings for `C:\Users\me\mtl\data\files` (is it `/run/desktop/mnt/host/c/...`, `C:\...`, `/host_mnt/c/...`?).
2. Same for: path with spaces, Vietnamese diacritics (e.g. `C:\Users\Nguyễn Văn\mtl`), D: drive, and project in `\\wsl$\Ubuntu\home\me\mtl` (and `\\wsl.localhost\`).
3. Runner container (created through socket from inside updater) with bind source = that exact Source string, same path as target: does it see the real `docker-compose.yml` and the same files (write a marker file, check from Explorer)?
4. Whether `/run/desktop/mnt/host/c/...` (if Source is a different form) is accepted back as bind source and maps to the same Windows folder (vs plain dir inside VM).
5. Labels `working_dir` / `config_files` content from PowerShell compose (Windows `C:\...` vs converted); with `COMPOSE_CONVERT_WINDOWS_PATHS` unset.
6. Runner `docker-compose -p mtl-local --project-directory <P> -f <P>/docker-compose.yml up -d` result: containers reused vs "Recreated" (config-hash drift from Binds string differences), data preserved, and subsequent PowerShell `docker compose up -d` recreate flip-flop.
7. `-v /var/run/docker.sock:/var/run/docker.sock` on DD Windows works from compose and from the runner; behavior with ECI on (Business) and with Hyper-V backend.
8. Postgres bind dir `./data/postgres` on a Windows-backed path (permissions/fsync) - separate from this plan but affects whether to keep bind vs named volume.
9. Compose `up -d --wait` timing on Windows with slow first healthcheck; `docker-compose` binary pulling with Windows credential helper (`desktop`/`wincred`) absent in runner -> private image pull failure.
10. DD Mac (non-OrbStack): Source form `/Users/...` vs `/host_mnt/Users/...` and no-admin install socket mkdir error (not Windows, but also unproven here).

## Unresolved questions
- Exact path inside `docker/compose-bin` image for the binary (check `docker run --entrypoint` / image layers).
- Does a no-healthcheck service count as ready under `--wait` in v5.x (docs says yes; untested).
- Rootless Docker exact failure mode for missing socket source.

Status: DONE_WITH_CONCERNS
Summary: Linux-style daemons (OrbStack) fully verified locally; Windows/DD Mac claims are web/inference only and listed for real-machine testing.
