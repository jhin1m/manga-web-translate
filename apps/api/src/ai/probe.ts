/**
 * Nút "Kiểm tra" của provider: 1 request nhẹ tới endpoint của provider để biết key có dùng được không.
 * Mọi request: không theo redirect (không gửi key sang host khác), timeout 10s, không retry; key chỉ ở header.
 * Kết quả chỉ mang phân loại — không trả body của provider.
 */
import type { AiProviderType, ProbeReason } from "@mtl/shared";

export type ProbeTarget = { type: AiProviderType; baseUrl: string | null };
export type ProbeResult = { ok: boolean; reason: ProbeReason; http_status: number | null; model_found?: boolean };
export type FetchFn = typeof fetch;

const TIMEOUT_MS = 10_000;
const BODY_CAP = 1_000_000;

type Reply = { status: number; text: string };

class Network extends Error {}

/** Đọc tối đa BODY_CAP byte rồi huỷ luồng (endpoint lạ không làm phình bộ nhớ); phần dư bị bỏ. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < BODY_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value.subarray(0, BODY_CAP - size));
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function send(fetchFn: FetchFn, url: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
  try {
    const res = await fetchFn(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Redirect: không đọc body, đóng luôn socket.
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      return { status: res.status, text: "" };
    }
    return { status: res.status, text: await readCapped(res) };
  } catch {
    throw new Network();
  }
}

const result = (reason: ProbeReason, status: number | null, extra: Partial<ProbeResult> = {}): ProbeResult => ({
  ok: reason === "ok",
  reason,
  http_status: status,
  ...extra,
});

/** Phân loại chung theo mã HTTP. */
function classify(r: Reply): ProbeReason {
  if (r.status >= 200 && r.status < 300) return "ok";
  if (r.status >= 300 && r.status < 400) return "redirect";
  if (r.status === 401 || r.status === 403) return "auth";
  if (r.status === 404) return "not_found";
  if (r.status === 402 || r.status === 429) return "quota";
  return "unknown";
}

/** Gemini trả 400 `API_KEY_INVALID` (không phải 401) khi key sai. */
const classifyGemini = (r: Reply): ProbeReason =>
  r.status === 400 && r.text.includes("API_KEY_INVALID") ? "auth" : classify(r);

function hasModel(text: string, model: string | undefined): boolean | undefined {
  if (!model) return undefined;
  try {
    const data = (JSON.parse(text) as { data?: { id?: unknown }[] }).data;
    return Array.isArray(data) ? data.some((m) => m.id === model) : undefined;
  } catch {
    return undefined;
  }
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function probeCompatible(base: string, key: string, model: string | undefined, fetchFn: FetchFn) {
  if (new URL(base).hostname === "openrouter.ai") {
    // /models của OpenRouter công khai → không chứng minh được key; /key thì có.
    const r = await send(fetchFn, `${base}/key`, bearer(key));
    return result(classify(r), r.status);
  }
  const list = await send(fetchFn, `${base}/models`, bearer(key));
  if (![404, 405, 501].includes(list.status)) {
    const reason = classify(list);
    return result(reason, list.status, reason === "ok" ? { model_found: hasModel(list.text, model) } : {});
  }
  if (!model) return result("not_found", list.status);
  // Endpoint không có /models → hỏi thử 1 token; 400 (tham số) vẫn chứng tỏ key được nhận.
  const ping = await send(fetchFn, `${base}/chat/completions`, bearer(key), {
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  });
  return result(ping.status === 400 ? "ok" : classify(ping), ping.status);
}

export async function probeProvider(
  p: ProbeTarget,
  key: string,
  model?: string,
  fetchFn: FetchFn = fetch,
): Promise<ProbeResult> {
  try {
    switch (p.type) {
      case "openai": {
        const r = await send(fetchFn, "https://api.openai.com/v1/models", bearer(key));
        const reason = classify(r);
        return result(reason, r.status, reason === "ok" ? { model_found: hasModel(r.text, model) } : {});
      }
      case "anthropic": {
        const r = await send(fetchFn, "https://api.anthropic.com/v1/models?limit=1", {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        });
        return result(classify(r), r.status);
      }
      case "gemini": {
        const r = await send(fetchFn, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
          "x-goog-api-key": key,
        });
        return result(classifyGemini(r), r.status);
      }
      case "openai_compatible":
        if (!p.baseUrl) return result("unknown", null);
        return await probeCompatible(p.baseUrl, key, model, fetchFn);
    }
  } catch (err) {
    if (err instanceof Network) return result("network", null);
    throw err;
  }
}
