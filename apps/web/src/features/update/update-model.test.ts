import { composeUrl, UPDATE_REASONS, type UpdateRun, type UpdateStatus } from "@mtl/shared/update";
import { describe, expect, it } from "vitest";
import {
  curlLine,
  failedRun,
  formatElapsed,
  landedReasonText,
  manualCommands,
  OFFLINE_TIMEOUT_MS,
  progressText,
  reasonFromBody,
  reasonText,
  SETTLE_MISSING_GRACE_MS,
  SETTLE_RUNNING_CAP_MS,
  showDot,
  startTracking,
  track,
} from "./update-model.ts";

const run = (over: Partial<UpdateRun> = {}): UpdateRun => ({
  state: "running",
  target: "0.4.0",
  from: "0.3.0",
  step: "pull",
  started_at: "2026-11-11T00:00:00Z",
  finished_at: null,
  exit_code: null,
  reason: null,
  log_tail: [],
  ...over,
});

const status = (over: Partial<UpdateStatus> = {}, r: UpdateRun | null = null): UpdateStatus => ({
  current: "0.3.0",
  check: "ok",
  latest: { version: "0.4.0", name: "v0.4.0", url: "https://example.test/r", source: "github" },
  update_available: true,
  pinned_tag: null,
  updater: { ready: true, reason: null, project: "mtl-local", run: r },
  ...over,
});

describe("track", () => {
  it("follows the step reported by the status while the app answers", () => {
    let t = startTracking("0.4.0");
    t = track(t, { type: "status", status: status({}, run({ step: "download" })), now: 0 });
    expect(t).toMatchObject({ outcome: "running", source: "status", step: "download" });
    expect(progressText(t)).toBe("Đang tải bản mới. Trong lúc này app vẫn chạy.");
  });

  it("switches to the restart message and /api/config polling when the app stops answering", () => {
    let t = startTracking("0.4.0", run({ step: "pull" }));
    t = track(t, { type: "offline", now: 1000 });
    expect(t).toMatchObject({ source: "config", offlineSince: 1000, outcome: "running" });
    expect(progressText(t)).toContain("khởi động lại");
  });

  it("keeps waiting for the run when /api/config reports the target version", () => {
    let t = track(startTracking("0.4.0"), { type: "offline", now: 0 });
    t = track(t, { type: "config", version: "0.4.0", now: 5000 });
    expect(t).toMatchObject({ outcome: "running", source: "status", landedAt: 5000 });
    expect(progressText(t)).toContain("bước cuối");
  });

  it("is done once the run of the target succeeded", () => {
    let t = track(startTracking("0.4.0"), { type: "config", version: "0.4.0", now: 0 });
    t = track(t, {
      type: "status",
      status: status({ current: "0.4.0" }, run({ state: "succeeded", step: "done" })),
      now: 2000,
    });
    expect(t.outcome).toBe("done");
  });

  it("fails with a landed failure when the run failed after the app reached the target", () => {
    const failed = run({ state: "failed", step: "check", reason: "up_failed" });
    let t = track(startTracking("0.4.0"), { type: "config", version: "0.4.0", now: 0 });
    t = track(t, { type: "status", status: status({ current: "0.4.0" }, failed), now: 2000 });
    expect(t).toMatchObject({ outcome: "failed", failure: { reason: "up_failed", run: failed, landed: true } });
  });

  it("waits while the run is still running, then reloads after the cap", () => {
    let t = track(startTracking("0.4.0"), { type: "config", version: "0.4.0", now: 0 });
    const going = status({ current: "0.4.0" }, run({ step: "check" }));
    t = track(t, { type: "status", status: going, now: SETTLE_RUNNING_CAP_MS });
    expect(t.outcome).toBe("running");
    t = track(t, { type: "status", status: going, now: SETTLE_RUNNING_CAP_MS + 1 });
    expect(t.outcome).toBe("done");
  });

  it("reloads when the run is missing or the updater is unavailable for longer than the grace", () => {
    const gone = status({
      current: "0.4.0",
      updater: { ready: false, reason: "unavailable", project: null, run: null },
    });
    let t = track(startTracking("0.4.0"), { type: "status", status: gone, now: 0 });
    t = track(t, { type: "status", status: gone, now: SETTLE_MISSING_GRACE_MS });
    expect(t.outcome).toBe("running");
    t = track(t, { type: "status", status: gone, now: SETTLE_MISSING_GRACE_MS + 1 });
    expect(t.outcome).toBe("done");
  });

  it("reloads when only /api/config answers for longer than the grace", () => {
    let t = track(startTracking("0.4.0"), { type: "config", version: "0.4.0", now: 0 });
    t = track(t, { type: "config", version: "0.4.0", now: SETTLE_MISSING_GRACE_MS + 1 });
    expect(t.outcome).toBe("done");
  });

  it("ignores a succeeded run of another target", () => {
    const t = track(startTracking("0.4.0"), {
      type: "status",
      status: status({ current: "0.4.0" }, run({ state: "succeeded", target: "0.3.5" })),
      now: 0,
    });
    expect(t.outcome).toBe("running");
  });

  it("asks the status again when the app is back on the old version, then fails with the run reason", () => {
    let t = track(startTracking("0.4.0"), { type: "offline", now: 0 });
    t = track(t, { type: "config", version: "0.3.0", now: 0 });
    expect(t).toMatchObject({ source: "status", offlineSince: null, outcome: "running" });
    const failed = run({ state: "failed", reason: "up_failed", step: "apply" });
    t = track(t, { type: "status", status: status({}, failed), now: 0 });
    expect(t.outcome).toBe("failed");
    expect(t.failure).toEqual({ reason: "up_failed", run: failed, landed: false });
  });

  it("ignores a failed run of another target", () => {
    const t = track(startTracking("0.4.0"), {
      type: "status",
      status: status({}, run({ state: "failed", target: "0.3.5", reason: "pull_failed" })),
      now: 0,
    });
    expect(t.outcome).toBe("running");
  });

  it("times out only after 20 minutes without an answer", () => {
    let t = track(startTracking("0.4.0"), { type: "offline", now: 0 });
    t = track(t, { type: "offline", now: OFFLINE_TIMEOUT_MS });
    expect(t.outcome).toBe("running");
    t = track(t, { type: "offline", now: OFFLINE_TIMEOUT_MS + 1 });
    expect(t).toMatchObject({ outcome: "failed", failure: { reason: "timeout" } });
  });

  it("does not time out while the app keeps answering, even after an hour of pulling", () => {
    let t = startTracking("0.4.0");
    for (let i = 0; i < 1800; i++) t = track(t, { type: "status", status: status({}, run({ step: "pull" })), now: i });
    expect(t.outcome).toBe("running");
  });

  it("resets the offline clock once the app answers again", () => {
    let t = track(startTracking("0.4.0"), { type: "offline", now: 0 });
    t = track(t, { type: "config", version: "0.3.0", now: 0 });
    t = track(t, { type: "offline", now: OFFLINE_TIMEOUT_MS * 2 });
    expect(t.outcome).toBe("running");
  });

  it("keeps a finished outcome", () => {
    const done = track(track(startTracking("0.4.0"), { type: "config", version: "0.4.0", now: 0 }), {
      type: "status",
      status: status({ current: "0.4.0" }, run({ state: "succeeded" })),
      now: 1,
    });
    expect(done.outcome).toBe("done");
    expect(track(done, { type: "offline", now: OFFLINE_TIMEOUT_MS * 9 })).toBe(done);
  });
});

describe("manual update", () => {
  it("uses curl.exe on Windows and curl elsewhere", () => {
    const url = composeUrl("main");
    expect(curlLine("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(`curl.exe -fsSLO ${url}`);
    expect(curlLine("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(`curl -fsSLO ${url}`);
    expect(curlLine("Mozilla/5.0 (X11; Linux x86_64)")).toBe(`curl -fsSLO ${url}`);
  });

  it("lists one command per line", () => {
    expect(manualCommands("Linux")).toEqual([
      `curl -fsSLO ${composeUrl("main")}`,
      "docker compose pull",
      "docker compose up -d",
    ]);
  });
});

describe("texts", () => {
  it("has a sentence for every reason", () => {
    for (const r of UPDATE_REASONS) expect(reasonText(r)).toMatch(/\S/);
    expect(reasonText(null)).toBe("Cập nhật lỗi.");
    expect(reasonText("cooldown")).toBe("Vừa thử cập nhật. Đợi một phút rồi thử lại.");
  });

  it("never says the app is down once it already runs the target version", () => {
    for (const r of UPDATE_REASONS) expect(landedReasonText(r)).not.toContain("App chưa chạy lại được");
    expect(landedReasonText("up_failed")).toContain("Worker hoặc tiến trình nền");
    expect(landedReasonText(null)).toMatch(/\S/);
  });

  it("reads the reason from an API error body", () => {
    expect(reasonFromBody({ error: "stale" })).toBe("stale");
    expect(reasonFromBody({ error: "x", reason: "busy" })).toBe("busy");
    expect(reasonFromBody({ error: "nope" })).toBeNull();
  });

  it("formats elapsed time as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("dot and failed run", () => {
  it("shows the dot until that version was seen", () => {
    expect(showDot(status(), null)).toBe(true);
    expect(showDot(status(), "0.4.0")).toBe(false);
    expect(showDot(status(), "0.3.9")).toBe(true);
    expect(showDot(status({ update_available: false }), null)).toBe(false);
    expect(showDot(undefined, null)).toBe(false);
  });

  it("hides the dot when pinned and the target is a stable release, not for a prerelease target", () => {
    expect(showDot(status({ pinned_tag: "0.3.0" }), null)).toBe(false);
    const rc = { version: "0.4.0-rc.1", name: "v0.4.0-rc.1", url: "u", source: "override" as const };
    expect(showDot(status({ pinned_tag: "0.3.0-rc.1", latest: rc }), null)).toBe(true);
  });

  it("reports a failed run only while the app is not on the target", () => {
    const failed = run({ state: "failed", reason: "pull_failed" });
    expect(failedRun(status({}, failed))).toBe(failed);
    expect(failedRun(status({ current: "0.4.0" }, failed))).toBeNull();
    expect(failedRun(status({}, run()))).toBeNull();
  });
});
