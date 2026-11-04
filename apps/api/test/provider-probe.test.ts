/** Nút "Kiểm tra": phân loại theo từng loại provider với fetch giả (không gọi mạng). */
import { describe, expect, it } from "vitest";
import { type FetchFn, probeProvider } from "../src/ai/probe.ts";

const KEY = "sk-secret-probe-key-9876";

type Call = { url: string; init: RequestInit };
type Reply = { status: number; body?: unknown } | Error;

/** fetch giả trả lần lượt các reply, ghi lại mọi request. */
function fake(...replies: Reply[]) {
  const calls: Call[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (!r) throw new Error("no reply");
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  };
  return { fn, calls };
}

const header = (c: Call | undefined, name: string) => (c?.init.headers as Record<string, string> | undefined)?.[name];

describe("probeProvider", () => {
  it("openai: 200 ok + model_found; 401 auth; 429 quota; 5xx unknown", async () => {
    const ok = fake({ status: 200, body: { data: [{ id: "gpt-4.1-mini" }] } });
    expect(await probeProvider({ type: "openai", baseUrl: null }, KEY, "gpt-4.1-mini", ok.fn)).toEqual({
      ok: true,
      reason: "ok",
      http_status: 200,
      model_found: true,
    });
    expect(ok.calls[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(header(ok.calls[0], "authorization")).toBe(`Bearer ${KEY}`);
    const missing = fake({ status: 200, body: { data: [{ id: "other" }] } });
    expect((await probeProvider({ type: "openai", baseUrl: null }, KEY, "gpt-4.1-mini", missing.fn)).model_found).toBe(
      false,
    );
    for (const [status, reason] of [
      [401, "auth"],
      [403, "auth"],
      [429, "quota"],
      [402, "quota"],
      [404, "not_found"],
      [500, "unknown"],
    ] as const) {
      const r = await probeProvider({ type: "openai", baseUrl: null }, KEY, undefined, fake({ status }).fn);
      expect(r, String(status)).toMatchObject({ ok: false, reason, http_status: status });
    }
  });

  it("anthropic: x-api-key + version header, limit=1", async () => {
    const f = fake({ status: 200, body: { data: [] } });
    expect(await probeProvider({ type: "anthropic", baseUrl: null }, KEY, undefined, f.fn)).toMatchObject({
      ok: true,
      reason: "ok",
    });
    expect(f.calls[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(header(f.calls[0], "x-api-key")).toBe(KEY);
    expect(header(f.calls[0], "anthropic-version")).toBe("2023-06-01");
    expect(
      (await probeProvider({ type: "anthropic", baseUrl: null }, KEY, undefined, fake({ status: 401 }).fn)).reason,
    ).toBe("auth");
  });

  it("gemini: key in header (not URL); 400 API_KEY_INVALID → auth, other 400 → unknown", async () => {
    const f = fake({ status: 400, body: { error: { details: [{ reason: "API_KEY_INVALID" }] } } });
    expect(await probeProvider({ type: "gemini", baseUrl: null }, KEY, undefined, f.fn)).toMatchObject({
      ok: false,
      reason: "auth",
      http_status: 400,
    });
    expect(f.calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
    expect(header(f.calls[0], "x-goog-api-key")).toBe(KEY);
    expect(
      (await probeProvider({ type: "gemini", baseUrl: null }, KEY, undefined, fake({ status: 400, body: {} }).fn))
        .reason,
    ).toBe("unknown");
    expect(
      (await probeProvider({ type: "gemini", baseUrl: null }, KEY, undefined, fake({ status: 200, body: {} }).fn)).ok,
    ).toBe(true);
  });

  it("compatible: GET {base}/models; OpenRouter uses /key", async () => {
    const f = fake({ status: 200, body: { data: [{ id: "m1" }] } });
    const r = await probeProvider(
      { type: "openai_compatible", baseUrl: "https://llm.example.com/v1" },
      KEY,
      "m1",
      f.fn,
    );
    expect(r).toMatchObject({ ok: true, model_found: true });
    expect(f.calls[0]?.url).toBe("https://llm.example.com/v1/models");

    const or = fake({ status: 200, body: {} });
    await probeProvider({ type: "openai_compatible", baseUrl: "https://openrouter.ai/api/v1" }, KEY, "m1", or.fn);
    expect(or.calls.map((c) => c.url)).toEqual(["https://openrouter.ai/api/v1/key"]);
  });

  it("compatible: 404 on /models falls back to a 1-token chat ping; 400 there still means the key was accepted", async () => {
    const base = { type: "openai_compatible", baseUrl: "https://llm.example.com/v1" } as const;
    const f = fake({ status: 404 }, { status: 400, body: { error: "bad param" } });
    expect(await probeProvider(base, KEY, "m1", f.fn)).toMatchObject({ ok: true, reason: "ok", http_status: 400 });
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://llm.example.com/v1/models",
      "https://llm.example.com/v1/chat/completions",
    ]);
    expect(f.calls[1]?.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[1]?.init.body))).toMatchObject({ model: "m1", max_tokens: 1 });
    expect((await probeProvider(base, KEY, "m1", fake({ status: 405 }, { status: 401 }).fn)).reason).toBe("auth");
    expect((await probeProvider(base, KEY, "m1", fake({ status: 404 }, { status: 404 }).fn)).reason).toBe("not_found");
    expect((await probeProvider(base, KEY, "m1", fake({ status: 501 }, { status: 429 }).fn)).reason).toBe("quota");
    // Không có model để ping → not_found từ /models.
    const noModel = fake({ status: 404 });
    expect(await probeProvider(base, KEY, undefined, noModel.fn)).toMatchObject({ ok: false, reason: "not_found" });
    expect(noModel.calls).toHaveLength(1);
  });

  it("never follows redirects: redirect:'manual' is passed and 3xx → redirect", async () => {
    const f = fake({ status: 302 });
    expect(await probeProvider({ type: "openai", baseUrl: null }, KEY, undefined, f.fn)).toEqual({
      ok: false,
      reason: "redirect",
      http_status: 302,
    });
    expect(f.calls[0]?.init.redirect).toBe("manual");
    expect(f.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("network failure and timeout → network", async () => {
    const down = fake(new TypeError("fetch failed"));
    expect(await probeProvider({ type: "openai", baseUrl: null }, KEY, undefined, down.fn)).toEqual({
      ok: false,
      reason: "network",
      http_status: null,
    });
    const slow = fake(new DOMException("timeout", "TimeoutError"));
    expect((await probeProvider({ type: "anthropic", baseUrl: null }, KEY, undefined, slow.fn)).reason).toBe("network");
  });

  it("the key only travels in headers: never in a URL or the result", async () => {
    const calls: Call[] = [];
    for (const t of [
      { type: "openai", baseUrl: null },
      { type: "anthropic", baseUrl: null },
      { type: "gemini", baseUrl: null },
      { type: "openai_compatible", baseUrl: "https://llm.example.com/v1" },
    ] as const) {
      const f = fake({ status: 200, body: { data: [] } });
      const r = await probeProvider(t, KEY, "m", f.fn);
      calls.push(...f.calls);
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
    for (const c of calls) expect(c.url).not.toContain(KEY);
  });

  it("reads at most the body cap then cancels the stream; redirect bodies are cancelled unread", async () => {
    let pulls = 0;
    let cancelled = false;
    const huge = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulls++;
        ctrl.enqueue(new Uint8Array(256 * 1024).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    });
    const f: FetchFn = async () => new Response(huge, { status: 200 });
    expect(await probeProvider({ type: "openai", baseUrl: null }, KEY, "m", f)).toMatchObject({
      ok: true,
      reason: "ok",
    });
    expect(cancelled).toBe(true);
    // 1 MB cap / 256 KB chunks = 4 chunks (+ vài chunk đọc trước của stream), không đọc vô hạn.
    expect(pulls).toBeLessThan(10);

    let redirectCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(new Uint8Array(10));
      },
      cancel() {
        redirectCancelled = true;
      },
    });
    const r: FetchFn = async () => new Response(body, { status: 301 });
    expect((await probeProvider({ type: "openai", baseUrl: null }, KEY, undefined, r)).reason).toBe("redirect");
    expect(redirectCancelled).toBe(true);
  });
});
