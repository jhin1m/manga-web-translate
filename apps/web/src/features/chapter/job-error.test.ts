import { describe, expect, it } from "vitest";
import {
  clock,
  describeJobError,
  failedPageGroups,
  nextQuotaReset,
  pageRanges,
  providerWait,
  providerWaitText,
} from "./job-error.ts";

const RAW =
  "gemini 429: 429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'You exceeded your current quota'}}";
const job = (over: Partial<Parameters<typeof describeJobError>[0] & object> = {}) => ({
  status: "queued",
  error_class: "rate_limited" as string | null,
  error: RAW as string | null,
  provider_retries: 2,
  run_after: "2026-10-20T19:20:00.000Z",
  ...over,
});

describe("job error text", () => {
  it("rate-limited job waiting for its backoff says it retries by itself, not the raw provider dump", () => {
    const d = describeJobError(job());
    expect(d?.waiting).toBe(true);
    expect(d?.text).toContain("hết hạn mức");
    expect(d?.text).toContain(`tự thử lại lúc ${clock("2026-10-20T19:20:00.000Z")}`);
    expect(d?.text).toContain("lần 2");
    expect(d?.text).not.toContain("RESOURCE_EXHAUSTED");
  });

  it("a job running again after a provider error has no retry time", () => {
    const d = describeJobError(job({ status: "running", error_class: "provider" }));
    expect(d).toEqual({ text: "Nhà cung cấp AI lỗi tạm thời — tự thử lại (lần 2).", waiting: true });
  });

  it("failed job names the class and the way to retry", () => {
    const d = describeJobError(job({ status: "failed", error_class: "schema", error: "bad json" }));
    expect(d?.waiting).toBe(false);
    expect(d?.text).toContain("AI trả sai định dạng");
    expect(d?.text).toContain("Dịch lại trang này");
    expect(describeJobError(job({ status: "failed" }))?.text).toContain("đã thử lại nhiều lần");
  });

  it("job stopped by the daily quota says so with the reset time", () => {
    const d = describeJobError(
      job({ status: "failed", error_class: "internal", error: "quota_exceeded: vượt hạn mức" }),
    );
    expect(d).toEqual({
      text: `Đã dùng hết hạn mức AI hôm nay — thử lại sau ${clock(nextQuotaReset())}.`,
      waiting: false,
    });
    expect(nextQuotaReset(new Date("2026-10-24T23:59:00Z"))).toBe("2026-10-25T00:00:00.000Z");
  });

  it("cancelled job says so instead of a bare error", () => {
    const d = describeJobError(job({ status: "cancelled", error_class: "internal", error: "cancelled by user" }));
    expect(d?.text).toContain("Đã huỷ xử lý");
    expect(d?.text).toContain("Chạy lại trang lỗi");
  });

  it("no error, or a finished job that once failed, says nothing", () => {
    expect(describeJobError(null)).toBeNull();
    expect(describeJobError(job({ error_class: null, error: null }))).toBeNull();
    expect(describeJobError(job({ status: "succeeded" }))).toBeNull();
  });
});

describe("provider wait band", () => {
  it("lists waiting pages and the earliest retry", () => {
    const w = providerWait([
      { ord: 0, job: job({ run_after: "2026-10-20T19:30:00.000Z" }) },
      { ord: 1, job: job({ status: "running" }) },
      { ord: 2, job: job({ run_after: "2026-10-20T19:21:00.000Z" }) },
      { ord: 3, job: job({ status: "failed" }) },
      { ord: 4, job: null },
    ]);
    expect(w).toEqual({ pages: [1, 2, 3], next: "2026-10-20T19:21:00.000Z", rateLimited: true });
    if (!w) throw new Error("expected wait");
    expect(providerWaitText(w)).toContain(`trang 1, 2, 3 đang chờ, tự thử lại lúc ${clock(w.next ?? "")}`);
    expect(providerWaitText(w)).toContain("Huỷ xử lý");
  });

  it("is null when no page is waiting on the provider", () => {
    expect(providerWait([{ ord: 0, job: job({ error_class: "internal" }) }])).toBeNull();
    expect(providerWait([])).toBeNull();
  });
});

describe("failed pages summary", () => {
  it("collapses consecutive pages into ranges", () => {
    expect(pageRanges([2, 3, 4, 6, 9, 13, 14, 15, 17, 18])).toBe("2–4, 6, 9, 13–15, 17, 18");
    expect(pageRanges([5, 1, 1])).toBe("1, 5");
    expect(pageRanges([])).toBe("");
  });

  it("groups failed pages by cause, biggest first, and tells what to fix for a rejected API key", () => {
    const f = (ord: number, error_class: string | null, error: string | null = null) => ({
      ord,
      job: { error_class, error },
    });
    const g = failedPageGroups([
      f(1, "auth", "anthropic 401: invalid x-api-key"),
      f(2, "auth"),
      f(4, "schema"),
      f(7, null),
    ]);
    expect(g.map((x) => [x.cls, x.count, x.pages])).toEqual([
      ["auth", 2, "2, 3"],
      ["schema", 1, "5"],
      ["internal", 1, "8"],
    ]);
    expect(g[0]?.label).toBe("AI từ chối khoá API");
    expect(g[0]?.hint).toContain("ANTHROPIC_API_KEY");
    expect(g[0]?.raw).toContain("401");
    expect(g[1]?.hint).toBeNull();
  });

  it("a failed job whose API key was rejected says to fix the key, not just retry", () => {
    const d = describeJobError(job({ status: "failed", error_class: "auth", error: "anthropic 401" }));
    expect(d?.text).toContain("Khoá API AI của worker");
  });
});
