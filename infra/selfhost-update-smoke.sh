#!/usr/bin/env bash
# Smoke for the in-app self-host update (Docker Compose bundle): install released version FROM from GHCR, seed data, click
# "Update now" over HTTP the way the web does, wait for version TO, then check data, stop/start order, bind paths,
# customisations (shell vars + .env) and the compose file. Run by hand on a dev machine (pulls real images) - NOT in CI.
#
#   FROM=0.3.0-rc.1 TO=0.3.0-rc.2 infra/selfhost-update-smoke.sh
#
# Both versions must already exist as git tags (vFROM, vTO) and as GHCR tags for ghcr.io/jhin1m/{mtl,mtl-worker}, and FROM
# must already contain the updater service. Locally built images (:smoke) cannot be used: the updater pulls from GHCR.
#   FROM, TO                 required, semver, TO > FROM
#   SMOKE_PORT=18083         localhost port of the app
#   SMOKE_MODELS_CACHE=<dir> copy already downloaded models (right sha256) into data/models, skips the first download
#   SMOKE_PAGE=<file>        page image for the seed step (default worker/tests/reference/render_lines.png). The seed only
#                            needs page.prepare to succeed; the OCR text check of the main smoke is not run here.
#   SMOKE_KEEP=1             keep the stack and the temp dir on exit (prints the path)
#   SMOKE_PREPARE_TIMEOUT_S  forwarded to selfhost-smoke.mjs (default 900)
# FROM a prerelease: MTL_TAG=FROM is exported (allowed because TO must then be a prerelease too).
# FROM official: MTL_TAG stays unset, so :latest must currently be FROM.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
. "$REPO/infra/lib.sh"

PROJECT=mtl-upd-smoke
RUNNER=$PROJECT-update
APP_IMAGE=ghcr.io/jhin1m/mtl
WORKER_IMAGE=ghcr.io/jhin1m/mtl-worker
VERSION_LABEL=org.opencontainers.image.version
# Same order as UPDATE_STEPS in packages/shared/src/update.ts.
EXPECTED_STEPS="preflight download pull verify apply check done"

usage() {
  cat >&2 <<'EOF'
usage: FROM=<semver> TO=<semver> infra/selfhost-update-smoke.sh
  FROM, TO              required, TO > FROM, both already released (git tag vX + GHCR images)
  SMOKE_PORT=18083      app port
  SMOKE_MODELS_CACHE    dir with already downloaded models
  SMOKE_PAGE            page image for the seed step
  SMOKE_KEEP=1          keep stack + temp dir
EOF
}
case ${1:-} in -h | --help) usage; exit 0 ;; esac
[ $# = 0 ] || { usage; die "unexpected arguments: $*"; }

# Dev shell variables must not leak into compose (they are interpolated); the ones the test needs are exported below.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES MTL_SKIP_BOOT_BACKUP MTL_ALLOWED_HOSTS MTL_WORKERS MTL_THREADS \
  MTL_TAG MTL_PORT MTL_UPDATE_CHECK MTL_UPDATE_TARGET MTL_UPDATER MTL_DOCKER_SOCK

SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
FROM=${FROM:-}
TO=${TO:-}
if [ -z "$FROM" ] || [ -z "$TO" ]; then
  usage
  die "FROM and TO are required"
fi
[[ $FROM =~ $SEMVER_RE ]] || die "FROM is not a semver (no leading v): $FROM"
[[ $TO =~ $SEMVER_RE ]] || die "TO is not a semver (no leading v): $TO"
SMOKE_PORT=${SMOKE_PORT:-18083}
[[ $SMOKE_PORT =~ ^[0-9]+$ ]] && [ "$SMOKE_PORT" -ge 1024 ] && [ "$SMOKE_PORT" -le 65535 ] || die "SMOKE_PORT must be 1024-65535: $SMOKE_PORT"

for c in docker node git; do command -v "$c" >/dev/null || die "missing command: $c"; done
docker compose version >/dev/null 2>&1 || die "docker compose plugin not available"
docker info >/dev/null 2>&1 || die "docker daemon not reachable"

# semver precedence: prints -1, 0 or 1 (prerelease < release, numeric ids < alphanumeric ids).
semver_cmp() {
  node -e '
    const parse = (s) => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(s); return { n: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split(".") : [] }; };
    const num = (x) => /^\d+$/.test(x);
    const [a, b] = [parse(process.argv[1]), parse(process.argv[2])];
    let r = 0;
    for (let i = 0; i < 3 && !r; i++) r = Math.sign(a.n[i] - b.n[i]);
    if (!r && (a.pre.length === 0 || b.pre.length === 0)) r = Math.sign(b.pre.length - a.pre.length);
    for (let i = 0; !r && i < Math.min(a.pre.length, b.pre.length); i++) {
      const [x, y] = [a.pre[i], b.pre[i]];
      if (x === y) continue;
      r = num(x) && num(y) ? Math.sign(Number(x) - Number(y)) : num(x) ? -1 : num(y) ? 1 : x < y ? -1 : 1;
    }
    if (!r) r = Math.sign(a.pre.length - b.pre.length);
    process.stdout.write(String(r));
  ' "$1" "$2"
}
[ "$(semver_cmp "$TO" "$FROM")" = 1 ] || die "TO ($TO) must be newer than FROM ($FROM)"
is_pre() { [[ $1 == *-* ]]; }
if is_pre "$FROM" && ! is_pre "$TO"; then
  die "FROM $FROM is a prerelease pinned with MTL_TAG, so the app refuses an official TO ($TO) (pinned). Use a prerelease TO, or an official FROM."
fi

for t in "v$FROM" "v$TO"; do
  git -C "$REPO" rev-parse --verify -q "refs/tags/$t^{commit}" >/dev/null || die "git tag $t does not exist in $REPO"
done
# Image tags must exist in GHCR (no pull yet).
for v in "$FROM" "$TO"; do
  for img in "$APP_IMAGE" "$WORKER_IMAGE"; do
    docker manifest inspect "$img:$v" >/dev/null 2>&1 || die "GHCR tag not found or not readable: $img:$v (push the release first)"
  done
done

# Stale stack or runner from a previous run (SMOKE_KEEP=1): never adopt it, never delete data we did not create.
if docker compose ls -a -q | grep -qx "$PROJECT"; then
  die "stack '$PROJECT' is left from a previous run - clean it first: docker compose -p $PROJECT down (then delete the temp dir that was printed)"
fi
if docker container inspect "$RUNNER" >/dev/null 2>&1; then
  die "container '$RUNNER' is left from a previous run - remove it: docker rm -f $RUNNER"
fi

if [ -n "${SMOKE_MODELS_CACHE:-}" ]; then
  [ -d "$SMOKE_MODELS_CACHE" ] || die "SMOKE_MODELS_CACHE is not a directory: $SMOKE_MODELS_CACHE"
  SMOKE_MODELS_CACHE=$(cd "$SMOKE_MODELS_CACHE" && pwd)
fi
SMOKE_PAGE=${SMOKE_PAGE:-$REPO/worker/tests/reference/render_lines.png}
[ -f "$SMOKE_PAGE" ] || die "SMOKE_PAGE is not a file: $SMOKE_PAGE"
SMOKE_PAGE=$(cd "$(dirname "$SMOKE_PAGE")" && pwd)/$(basename "$SMOKE_PAGE")
export SMOKE_PAGE_FILE=$SMOKE_PAGE

# FROM official: the compose file pulls :latest, which must be FROM right now.
if ! is_pre "$FROM"; then
  docker pull -q "$APP_IMAGE:latest" >/dev/null || die "cannot pull $APP_IMAGE:latest"
  latest_v=$(docker image inspect -f "{{index .Config.Labels \"$VERSION_LABEL\"}}" "$APP_IMAGE:latest")
  [ "$latest_v" = "$FROM" ] || die ":latest is $latest_v, not FROM=$FROM. Use a prerelease FROM, or run this before :latest moves on."
fi

# ---- from here on a temp dir and containers exist ----
MJS="$REPO/infra/selfhost-smoke.mjs"
BASE="http://127.0.0.1:$SMOKE_PORT"
export MTL_PORT=$SMOKE_PORT
# Customisations the updater must restore from the running containers: shell-only vars here, .env below.
export MTL_WORKERS=1 MTL_UPDATE_TARGET=$TO
is_pre "$FROM" && export MTL_TAG=$FROM

T0=$(date +%s)
TIMES=()
STEP_NAME=""
STEP_T=0
step() { # step <name>: record the previous step's time, announce the next
  local now
  now=$(date +%s)
  [ -n "$STEP_NAME" ] && TIMES+=("$STEP_NAME: $((now - STEP_T))s")
  STEP_NAME=$1 STEP_T=$now
  log "== $1"
}

work=$(mktemp -d "${TMPDIR:-/tmp}/mtl-upd-smoke.XXXXXX")
work=$(cd "$work" && pwd -P) # macOS: /var -> /private/var (shared with the Docker VM)
dc() { docker compose -p "$PROJECT" -f "$work/docker-compose.yml" "$@"; }
EVENTS_PID=""

cleanup() {
  local rc=$?
  set +e # cleanup must not change the exit code
  [ -n "$EVENTS_PID" ] && kill "$EVENTS_PID" 2>/dev/null
  if [ "${SMOKE_KEEP:-}" = 1 ]; then
    log "SMOKE_KEEP=1 -> keeping stack '$PROJECT' at $work (clean: docker rm -f $RUNNER; cd $work && docker compose -p $PROJECT down)"
    exit "$rc"
  fi
  if [ "$rc" != 0 ]; then
    [ -f "$work/docker-compose.yml" ] && { log "last log lines per service:"; dc logs --no-color --tail 40 >&2; }
    docker container inspect "$RUNNER" >/dev/null 2>&1 && { log "runner log (tail):"; docker logs --tail 60 "$RUNNER" >&2; }
  fi
  docker rm -f "$RUNNER" >/dev/null 2>&1
  [ -f "$work/docker-compose.yml" ] && dc down --remove-orphans >/dev/null 2>&1
  # data/postgres is owned by uid 999 and the rest by uid 1000: delete from inside a container.
  [ -d "$work/data" ] && docker run --rm -v "$work:/w" busybox rm -rf /w/data >/dev/null 2>&1
  rm -rf "$work" || log "could not delete $work - delete it by hand"
  exit "$rc"
}
trap cleanup EXIT

RESP=$work/resp.json
REQ_CODE=000
req() { # req <METHOD> <path> [curl args...] -> REQ_CODE, body in $RESP
  local m=$1 p=$2
  shift 2
  : >"$RESP"
  REQ_CODE=$($CURL -sS -m 30 -o "$RESP" -w '%{http_code}' -X "$m" "$@" "$BASE$p" 2>/dev/null) || REQ_CODE=000
}
expect() { # expect <status> <what>
  [ "$REQ_CODE" = "$1" ] || die "$2: HTTP $REQ_CODE (need $1): $(head -c 400 "$RESP")"
}
jget() { # jget <dotted.path> < json -> value ("" for null/missing, JSON for objects); exit 3 when not JSON
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let v;
      try { v = JSON.parse(s); } catch { process.exit(3); }
      for (const k of process.argv[1].split(".")) v = v == null ? undefined : v[k];
      process.stdout.write(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    });
  ' "$1"
}
JSON_H='content-type: application/json'
post_update() { req POST /api/admin/update -H "Origin: $BASE" -H "$JSON_H" -d "{\"version\":\"$1\"}"; }

in_app() { dc exec -T app sh -c "$1"; }
count_backups() {
  local out
  out=$(in_app 'find /data/backups -maxdepth 1 -name "mtl-*.dump" | wc -l') || die "cannot read /data/backups"
  echo "${out//[[:space:]]/}"
}
count_migrations() {
  local out
  out=$(dc exec -T postgres psql -U mtl -d mtl -AtX -v ON_ERROR_STOP=1 -c 'select count(*) from drizzle.__drizzle_migrations') \
    || die "cannot count migrations"
  echo "${out//[[:space:]]/}"
}
fstat() { stat -c '%u %g %a' "$1" 2>/dev/null || stat -f '%u %g %Lp' "$1"; } # GNU / BSD
file_sha() { sha256 "$1" | cut -d' ' -f1; }
project_ids() { docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"; }
# One line per bind mount of every container of the project: "<service> <Source>-><Destination>".
binds() {
  local id
  for id in $(project_ids); do
    docker inspect -f '{{$s := index .Config.Labels "com.docker.compose.service"}}{{range .Mounts}}{{if eq .Type "bind"}}{{$s}} {{.Source}}->{{.Destination}}{{"\n"}}{{end}}{{end}}' "$id"
  done | sort -u
}
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1"; }
image_version() { # image_version <container id> -> OCI version label of the image the container runs
  local img
  img=$(docker inspect -f '{{.Image}}' "$1")
  docker image inspect -f "{{index .Config.Labels \"$VERSION_LABEL\"}}" "$img"
}
runner_state() { docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$RUNNER" 2>/dev/null || echo "missing -1"; }
runner_log() { docker logs "$RUNNER" 2>&1 | tr -d '\r'; }
status_poll() { # status_poll <seconds> <jq-ish path> <wanted>: GET /api/admin/update until the value matches
  local until=$((SECONDS + $1))
  while ((SECONDS < until)); do
    req GET /api/admin/update
    if [ "$REQ_CODE" = 200 ] && [ "$(jget "$2" <"$RESP" || true)" = "$3" ]; then return 0; fi
    sleep 2
  done
  return 1
}

step "install FROM=$FROM (compose of tag v$FROM, real GHCR images)"
git -C "$REPO" show "v$FROM:docker-compose.yml" >"$work/docker-compose.yml" || die "cannot read docker-compose.yml at v$FROM"
grep -q 'command: updater' "$work/docker-compose.yml" || die "v$FROM has no updater service: pick a FROM that already ships the updater"
mkdir -p "$work/ref"
cp "$work/docker-compose.yml" "$work/ref/compose-from.yml"
git -C "$REPO" show "v$TO:docker-compose.yml" >"$work/ref/compose-to.yml" || die "cannot read docker-compose.yml at v$TO"
chmod 640 "$work/docker-compose.yml" # distinct from the 600 the runner writes its temp file with: proves the mode is kept
printf 'MTL_THREADS=2\n' >"$work/.env"
cd "$work"
if [ -n "${SMOKE_MODELS_CACHE:-}" ]; then
  mkdir -p data/models
  cp -R "$SMOKE_MODELS_CACHE"/. data/models/
fi
dc up -d --wait --wait-timeout 900
req GET /api/config
expect 200 "GET /api/config"
[ "$(jget version <"$RESP")" = "$FROM" ] || die "/api/config version is '$(jget version <"$RESP" || true)', need $FROM"
status_poll 90 updater.ready true || die "updater never became ready: $(head -c 500 "$RESP")"
[ "$(jget current <"$RESP")" = "$FROM" ] || die "status current != $FROM: $(head -c 400 "$RESP")"
[ "$(jget update_available <"$RESP")" = true ] || die "update_available is not true: $(head -c 400 "$RESP")"
[ "$(jget latest.version <"$RESP")" = "$TO" ] || die "latest.version is not $TO: $(head -c 400 "$RESP")"
log "FROM $FROM is up; update_available, latest=$TO, updater ready"

step "seed data + record baselines"
node "$MJS" run "$BASE" "$work/smoke-state.json"
mig_before=$(count_migrations)
bak_before=$(count_backups)
binds >"$work/binds-before.txt"
[ -s "$work/binds-before.txt" ] || die "no bind mounts found before the update (label query broken?)"
grep -q '^app .*docker.sock' "$work/binds-before.txt" && die "app container mounts the Docker socket"
stat_before=$(fstat "$work/docker-compose.yml")
sha_before=$(file_sha "$work/docker-compose.yml")
old_app=$(dc ps -q app)
old_jw=$(printf '%s\n%s' "$(dc ps -q jobs)" "$(dc ps -q worker)" | grep . | paste -sd, -)
[ -n "$old_app" ] && [ -n "$old_jw" ] || die "cannot find app/jobs/worker containers before the update"
log "baseline: migrations=$mig_before backups=$bak_before compose stat(uid gid mode)='$stat_before' binds=$(wc -l <"$work/binds-before.txt" | tr -d ' ')"

step "negative checks (before updating)"
req POST /api/admin/update -H 'Origin: http://evil.test' -H "$JSON_H" -d "{\"version\":\"$TO\"}"
expect 403 "POST with foreign Origin"
req GET /api/admin/update -H 'Host: evil.test'
expect 403 "GET with foreign Host (DNS rebinding)"
req POST /api/admin/update -H "Origin: $BASE" -H 'content-type: text/plain' -d "{\"version\":\"$TO\"}"
expect 415 "POST without JSON content-type"
post_update 99.0.0
expect 409 "POST with a version that is not the latest"
[ "$(jget reason <"$RESP" || true)" = stale ] || die "wrong-version reason is not 'stale': $(head -c 300 "$RESP")"
tok_js="fetch('http://updater:8090/v1/status',{headers:{authorization:'Bearer x'}}).then(r=>console.log(r.status),e=>{console.log('ERR '+e.message);process.exit(1)})"
code=$(dc exec -T app node -e "$tok_js") || die "cannot reach the updater from the app container: $code"
[ "$code" = 401 ] || die "updater with a wrong token answered $code (need 401)"
case $(dc ps --format '{{.Ports}}' updater) in *'->'*) die "updater publishes a host port" ;; esac
log "403 foreign Origin/Host, 415 non-JSON, 409 stale, updater 401 on a bad token, updater has no published port"

step "trigger the update"
t0=$(date +%s)
docker events --since "$t0" --filter type=container --filter "label=com.docker.compose.project=$PROJECT" \
  --format '{{json .}}' >"$work/events.jsonl" 2>"$work/events.err" &
EVENTS_PID=$!
sleep 1
kill -0 "$EVENTS_PID" 2>/dev/null || die "docker events did not start: $(cat "$work/events.err")"
post_update "$TO"
expect 202 "POST /api/admin/update"
[ "$(jget run.target <"$RESP" || true)" = "$TO" ] || die "202 body has no run.target=$TO: $(head -c 300 "$RESP")"
post_update "$TO"
case $REQ_CODE in 409 | 429) ;; *) die "second POST right after: HTTP $REQ_CODE (need 409 busy or 429 cooldown): $(head -c 300 "$RESP")" ;; esac
log "202 accepted; second POST answered $REQ_CODE ($(jget reason <"$RESP" || true))"

step "wait for version $TO (like the web: status while the app answers, /api/config when it does not)"
deadline=$((SECONDS + 1200))
last_note=""
while :; do
  ((SECONDS < deadline)) || die "version $TO not reached within 20 minutes"
  read -r r_status r_code <<<"$(runner_state)"
  if [ "$r_status" = exited ] && [ "$r_code" != 0 ]; then
    runner_log | tail -n 40 >&2
    die "runner exited with code $r_code (see log above)"
  fi
  note="runner=$r_status"
  last_step=$(runner_log | sed -n "s/^MTL_UPDATE step=//p" | tail -n 1 || true)
  [ -n "$last_step" ] && note="$note step=$last_step"
  req GET /api/admin/update
  if [ "$REQ_CODE" = 200 ]; then
    [ "$(jget updater.run.state <"$RESP" || true)" = failed ] && die "updater reports a failed run: $(jget updater.run <"$RESP")"
    cur=$(jget current <"$RESP" || true)
    note="$note app=up($cur)"
  else
    req GET /api/config
    cur=$([ "$REQ_CODE" = 200 ] && jget version <"$RESP" || true)
    note="$note app=offline"
  fi
  [ "$note" = "$last_note" ] || log "  $note"
  last_note=$note
  [ "$cur" = "$TO" ] && break
  sleep 3
done
# The app is on TO; the runner may still be starting jobs/worker/updater and running its own checks.
deadline=$((SECONDS + 600))
until read -r r_status r_code <<<"$(runner_state)"; [ "$r_status" = exited ]; do
  ((SECONDS < deadline)) || die "runner still running 10 minutes after the app reached $TO"
  sleep 3
done
sleep 2
kill "$EVENTS_PID" 2>/dev/null || true
wait "$EVENTS_PID" 2>/dev/null || true
EVENTS_PID=""

step "check: runner log, containers, stop/start order"
[ "$r_code" = 0 ] || die "runner exit code $r_code (need 0)"
runner_log >"$work/runner.log"
got_steps=$(sed -n 's/^MTL_UPDATE step=//p' "$work/runner.log" | paste -sd' ' -)
[ "$got_steps" = "$EXPECTED_STEPS" ] || die "runner step markers '$got_steps' != '$EXPECTED_STEPS'"
grep -qx 'MTL_UPDATE result=ok' "$work/runner.log" || die "runner log has no 'MTL_UPDATE result=ok'"
log "runner exit 0, steps: $got_steps, result=ok"

new_app=$(dc ps -q app)
new_jw=$(printf '%s\n%s' "$(dc ps -q jobs)" "$(dc ps -q worker)" | grep . | paste -sd, -)
[ -n "$new_app" ] && [ -n "$new_jw" ] || die "app/jobs/worker not running after the update"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$new_app")" = healthy ] || die "app is not healthy after the update"
for svc in jobs worker updater postgres; do
  id=$(dc ps -q "$svc")
  [ -n "$id" ] || die "service $svc has no container after the update"
  [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ] || die "service $svc is not running after the update"
done
for id in $(project_ids); do
  [ "$(docker inspect -f '{{.RestartCount}}' "$id")" = 0 ] || die "container $(docker inspect -f '{{.Name}}' "$id") restarted (RestartCount != 0)"
done
cat >"$work/order.mjs" <<'JS'
// Stop/start order from `docker events`: old jobs+worker are dead before the old app is destroyed and before the new app
// starts (so migrations never run beside old code); jobs+worker only start after the new app became healthy.
import { readFileSync } from "node:fs";
const [file, oldApp, newApp, oldJw, newJw] = process.argv.slice(2);
const ids = (s) => s.split(",").filter(Boolean);
const jw = new Set([...ids(oldJw), ...ids(newJw)]);
const ev = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l, i) => {
  const e = JSON.parse(l);
  return { i, id: e.Actor?.ID ?? e.id, action: e.Action };
});
const first = (id, ...actions) => ev.find((e) => e.id === id && actions.includes(e.action))?.i;
const fail = (m) => { console.error(`ORDER FAIL: ${m}`); process.exit(1); };
if (oldApp === newApp) fail("the app container was not recreated");
const destroyed = first(oldApp, "destroy");
const oldDie = first(oldApp, "die");
const started = first(newApp, "start");
const healthy = first(newApp, "health_status: healthy");
for (const [n, v] of Object.entries({ destroyed, oldDie, started, healthy })) if (v === undefined) fail(`no event for ${n}`);
for (const id of ids(oldJw)) {
  const stopped = first(id, "die", "stop");
  if (stopped === undefined) fail(`old container ${id.slice(0, 12)} never stopped`);
  if (stopped > Math.min(destroyed, started)) fail(`old container ${id.slice(0, 12)} stopped (#${stopped}) after the old app was destroyed (#${destroyed}) or the new app started (#${started})`);
}
for (const e of ev) if (jw.has(e.id) && e.action === "start" && e.i > oldDie && e.i < healthy) fail(`jobs/worker ${e.id.slice(0, 12)} started (#${e.i}) before the new app was healthy (#${healthy})`);
for (const id of ids(newJw)) {
  const lastStart = ev.filter((e) => e.id === id && e.action === "start").at(-1)?.i;
  if (lastStart === undefined || lastStart < healthy) fail(`new container ${id.slice(0, 12)} did not start after the new app was healthy (#${healthy})`);
}
console.log(`order ok: jobs/worker stopped before app destroy #${destroyed} / new start #${started}; started after healthy #${healthy}`);
JS
node "$work/order.mjs" "$work/events.jsonl" "$old_app" "$new_app" "$old_jw" "$new_jw" || die "stop/start order is wrong (events: $work/events.jsonl)"

step "check: data, binds, customisations, compose file"
node "$MJS" verify "$BASE" "$work/smoke-state.json"
mig_after=$(count_migrations)
[ "$mig_after" -ge "$mig_before" ] || die "migrations went down: $mig_before -> $mig_after"
bak_after=$(count_backups)
[ "$bak_after" = $((bak_before + 1)) ] || die "backups $bak_before -> $bak_after (need +1)"
log "migrations $mig_before -> $mig_after, backups $bak_before -> $bak_after"
binds >"$work/binds-after.txt"
diff -u "$work/binds-before.txt" "$work/binds-after.txt" || die "bind mounts changed after the update (diff above)"
log "bind Source->Destination identical for every service ($(wc -l <"$work/binds-after.txt" | tr -d ' ') binds)"
case $(dc ps --format '{{.Ports}}' app | tr ',' '\n' | grep -- '->' | sed 's/^ *//') in
  "127.0.0.1:$SMOKE_PORT->8080/tcp") ;;
  *) die "app bind is not 127.0.0.1:$SMOKE_PORT->8080/tcp: $(dc ps --format '{{.Ports}}' app)" ;;
esac
n_workers=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.service=worker' | wc -l | tr -d ' ')
[ "$n_workers" = 1 ] || die "worker containers: $n_workers (need 1, MTL_WORKERS=1)"
worker_id=$(dc ps -q worker)
env_of "$worker_id" | grep -qx 'MTL_THREADS=2' || die "worker env lost MTL_THREADS=2 (.env customisation)"
env_of "$worker_id" | grep -qx 'MTL_WORKERS=1' || die "worker env lost MTL_WORKERS=1"
env_of "$new_app" | grep -qx "MTL_UPDATE_TARGET=$TO" || die "app env lost MTL_UPDATE_TARGET=$TO (shell-only customisation)"
log "port 127.0.0.1:$SMOKE_PORT, 1 worker, MTL_THREADS=2 (.env), MTL_UPDATE_TARGET=$TO (shell) kept"
cmp -s "$work/docker-compose.yml" "$work/ref/compose-to.yml" || die "docker-compose.yml differs from the one at tag v$TO"
cmp -s "$work/docker-compose.yml.bak" "$work/ref/compose-from.yml" || die "docker-compose.yml.bak differs from the one at tag v$FROM"
# Two tags on the same commit ship the same compose file: then only the .bak above proves the write happened.
if ! cmp -s "$work/ref/compose-from.yml" "$work/ref/compose-to.yml"; then
  [ "$(file_sha "$work/docker-compose.yml")" != "$sha_before" ] || die "docker-compose.yml was not replaced"
fi
[ "$(fstat "$work/docker-compose.yml")" = "$stat_before" ] || die "compose file uid/gid/mode '$(fstat "$work/docker-compose.yml")' != '$stat_before'"
log "compose == v$TO, .bak == v$FROM, uid/gid/mode kept ($stat_before)"
req GET /api/admin/update
expect 200 "GET /api/admin/update after the update"
[ "$(jget update_available <"$RESP")" = false ] || die "update_available is not false after the update: $(head -c 400 "$RESP")"
[ "$(jget updater.run.state <"$RESP" || true)" = succeeded ] || die "updater.run.state is not 'succeeded': $(jget updater.run <"$RESP" || true)"
log "update_available=false, run.state=succeeded"
for svc in app jobs worker updater; do
  v=$(image_version "$(dc ps -q "$svc")")
  [ "$v" = "$TO" ] || die "$svc runs an image labelled '$v', need $TO"
done

step "user runs compose by hand after the update (must not downgrade)"
# A prerelease is never the default tag, so a user who got here pins it (as the rc release notes say); official keeps :latest.
if is_pre "$TO"; then export MTL_TAG=$TO; else unset MTL_TAG; fi
dc up -d --wait --wait-timeout 600
req GET /api/config
expect 200 "GET /api/config after manual up"
[ "$(jget version <"$RESP")" = "$TO" ] || die "manual 'up -d' changed the app version to '$(jget version <"$RESP")'"
for svc in app jobs worker updater; do
  v=$(image_version "$(dc ps -q "$svc")")
  [ "$v" = "$TO" ] || die "after manual up $svc runs an image labelled '$v', need $TO"
done
node "$MJS" verify "$BASE" "$work/smoke-state.json"
binds >"$work/binds-manual.txt"
diff -u "$work/binds-before.txt" "$work/binds-manual.txt" || die "bind mounts changed after the manual up (diff above)"
log "manual up kept $TO, data and binds"

step "MTL_UPDATER=0 removes the updater"
MTL_UPDATER=0 dc up -d --wait --wait-timeout 600 --remove-orphans
[ -z "$(dc ps -aq updater)" ] || die "updater container still exists with MTL_UPDATER=0"
status_poll 60 updater.reason unavailable || die "updater.reason is not 'unavailable' with MTL_UPDATER=0: $(head -c 400 "$RESP")"
log "no updater container, updater.reason=unavailable"

step "done"
log "images: $(docker image inspect -f '{{index .RepoDigests 0}}' "$APP_IMAGE:$(is_pre "$TO" && echo "$TO" || echo latest)" 2>/dev/null || echo '?') | $(docker image inspect -f '{{index .RepoDigests 0}}' "$WORKER_IMAGE:$(is_pre "$TO" && echo "$TO" || echo latest)" 2>/dev/null || echo '?')"
log "time per step:"
for t in "${TIMES[@]}"; do log "  $t"; done
log "total: $(($(date +%s) - T0))s"
echo "UPDATE SMOKE OK"
