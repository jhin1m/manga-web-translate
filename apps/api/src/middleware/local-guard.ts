/**
 * Chế độ local không có đăng nhập → bind 127.0.0.1 chưa đủ: trang lạ mở trong trình duyệt của người dùng vẫn gửi
 * request tới localhost. Middleware này (chỉ mount khi MTL_LOCAL_MODE, trước mọi route) chặn:
 * - DNS rebinding: hostname của `Host` phải thuộc danh sách cho phép (localhost, 127.0.0.1, [::1], `app` = tên service
 *   compose mà worker gọi, + MTL_ALLOWED_HOSTS) → ngược lại 403;
 * - CSRF: method không an toàn có `Origin` khác `Host`, hoặc `Sec-Fetch-Site: cross-site` → 403.
 * Worker (httpx) không gửi `Origin`/`Sec-Fetch-Site` nên không bị ảnh hưởng.
 */
import { createMiddleware } from "hono/factory";

export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "app"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `host[:port]` → `{ host (có cổng, chữ thường), hostname }`; không parse được → null. */
function parseHost(h: string): { host: string; hostname: string } | null {
  try {
    const u = new URL(`http://${h}`);
    if (u.username || u.password || u.pathname !== "/") return null;
    return { host: u.host, hostname: u.hostname };
  } catch {
    return null;
  }
}

const forbidden = (reason: string) => Response.json({ error: "forbidden", reason }, { status: 403 });

/**
 * Chuẩn hoá 1 mục MTL_ALLOWED_HOSTS về dạng `URL.hostname` (bỏ cổng, IPv6 trong ngoặc vuông) để so khớp được;
 * mục không parse được → null.
 */
export function normalizeAllowedHost(entry: string): string | null {
  const h = entry.trim();
  // IPv6 trần (`::1`, `fe80::1`) → thêm ngoặc; `host:port` giữ nguyên để URL tách cổng.
  const bracketed = !h.startsWith("[") && (h.match(/:/g)?.length ?? 0) > 1 ? `[${h}]` : h;
  return parseHost(bracketed)?.hostname ?? null;
}

export function localGuard(extraHosts: readonly string[] = []) {
  const extra = extraHosts.map((h) => ({ h, n: normalizeAllowedHost(h) }));
  for (const { h, n } of extra) if (!n) console.warn(`[local-guard] bỏ qua MTL_ALLOWED_HOSTS không hợp lệ: ${h}`);
  const allowed = new Set<string>([...LOCAL_HOSTS, ...extra.flatMap(({ n }) => (n ? [n] : []))]);
  return createMiddleware(async (c, next) => {
    // node-server dựng URL từ header Host; app.request (test) không có header → dùng host của URL.
    const host = parseHost(c.req.header("host") ?? new URL(c.req.url).host);
    if (!host || !allowed.has(host.hostname)) return forbidden("host");
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined) {
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          // `Origin: null` (sandbox/file://) hoặc rác → coi là khác origin
        }
        if (originHost !== host.host) return forbidden("origin");
      }
      if (c.req.header("sec-fetch-site") === "cross-site") return forbidden("cross-site");
    }
    await next();
  });
}
