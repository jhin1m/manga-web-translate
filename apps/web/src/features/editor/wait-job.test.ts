import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api.ts", () => ({ api: apiMock }));

import { waitJob } from "./api.ts";

const job = (status: string) => ({ id: "j1", status });

beforeEach(() => {
  vi.useFakeTimers();
  apiMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("waitJob", () => {
  it("polls until the job is done and reports intermediate polls", async () => {
    apiMock.mockResolvedValueOnce(job("queued")).mockResolvedValueOnce(job("succeeded"));
    const onPoll = vi.fn();
    const p = waitJob("j1", undefined, 1500, onPoll);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toMatchObject({ status: "succeeded" });
    expect(onPoll).toHaveBeenCalledTimes(1);
  });

  it("rejects even when the in-flight poll comes back finished after the abort", async () => {
    const ctl = new AbortController();
    let resolveFetch: (v: unknown) => void = () => undefined;
    apiMock.mockReturnValueOnce(new Promise((r) => (resolveFetch = r)));
    const p = waitJob("j1", ctl.signal, 1500);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    ctl.abort();
    resolveFetch(job("succeeded"));
    await assertion;
  });

  it("rejects at once, not after the poll interval, when aborted during a fetch that returns queued", async () => {
    const ctl = new AbortController();
    let resolveFetch: (v: unknown) => void = () => undefined;
    apiMock.mockReturnValueOnce(new Promise((r) => (resolveFetch = r)));
    const p = waitJob("j1", ctl.signal, 1500);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    ctl.abort();
    resolveFetch(job("queued"));
    // Không tiến timer: nếu còn ngủ 1.5s thì assertion treo → test timeout.
    await assertion;
  });

  it("rejects immediately when aborted while sleeping between polls", async () => {
    const ctl = new AbortController();
    apiMock.mockResolvedValue(job("queued"));
    const p = waitJob("j1", ctl.signal, 1500);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10);
    ctl.abort();
    await assertion;
  });
});
