/**
 * Every `${VAR}` in docker-compose.yml and what the runner does with it when it re-runs compose. The runner never
 * sees the user's shell, so a value typed there (`MTL_WORKERS=1 docker compose up -d`) is lost unless it is read back
 * from the running containers. A test fails when the compose file gains a variable that is missing here.
 *
 *  restore  read back from the running project and passed as a process env var (shell env beats `.env` in compose)
 *  fixed    constant chosen by the updater
 *  target   derived from the update target (the image tag)
 *  drop     deliberately not carried over; compose falls back to `.env` or the default
 */
export type VarSource =
  | { action: "restore"; from: "app-port" | "app-env" | "worker-count" | "worker-env" | "updater-env" }
  | { action: "fixed"; value: string }
  | { action: "target" }
  | { action: "drop" };

export const COMPOSE_VARS: Record<string, VarSource> = {
  MTL_PORT: { action: "restore", from: "app-port" },
  MTL_ALLOWED_HOSTS: { action: "restore", from: "app-env" },
  MTL_UPDATE_CHECK: { action: "restore", from: "app-env" },
  MTL_UPDATE_TARGET: { action: "restore", from: "app-env" },
  // Counted, not read from env: keeps the zero-worker case.
  MTL_WORKERS: { action: "restore", from: "worker-count" },
  MTL_THREADS: { action: "restore", from: "worker-env" },
  MTL_DOCKER_SOCK: { action: "restore", from: "updater-env" },
  // The running updater is the one asking for the update.
  MTL_UPDATER: { action: "fixed", value: "1" },
  // An in-app update always takes a DB backup before migrating.
  MTL_SKIP_BOOT_BACKUP: { action: "fixed", value: "" },
  MTL_TAG: { action: "target" },
};

export const restoredVarNames = Object.entries(COMPOSE_VARS)
  .filter(([, v]) => v.action === "restore")
  .map(([k]) => k);
