/**
 * `/files/<key>?…` — phục vụ link ký HMAC của disk driver (thay MinIO ở bản self-host). Ngoài `/api`, không cookie:
 * quyền nằm hết trong chữ ký (xem storage-drivers/file-signing.ts).
 * - GET/HEAD: có Range; nosniff + CSP sandbox (file người dùng không bao giờ chạy như trang cùng origin).
 * - PUT: output worker; header `content-type` (+ `x-amz-tagging`) phải khớp tham số đã ký.
 * - POST multipart: upload người dùng theo policy đã ký (Content-Type cố định, dung lượng [1, max]); 204 như MinIO.
 */
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ByteRange, DiskDriver } from "../storage-drivers/disk-driver.ts";
import type { FileSigParams } from "../storage-drivers/file-signing.ts";

/** Phần multipart ngoài byte file (boundary, header part, field Content-Type). */
const POST_OVERHEAD = 64 * 1024;

const fail = (c: Context, status: ContentfulStatusCode, error: string) => c.json({ error }, status);

/** Hono đã decode param; key sai định dạng/traversal → null (400). */
function keyOf(c: Context, d: DiskDriver): string | null {
  const key = c.req.param("key");
  if (!key) return null;
  try {
    d.resolveKey(key);
    return key;
  } catch {
    return null;
  }
}

function sigParams(method: FileSigParams["method"], key: string, q: URLSearchParams): FileSigParams {
  const max = q.get("max");
  return {
    method,
    key,
    exp: Number(q.get("exp") ?? Number.NaN),
    ct: q.get("ct") ?? undefined,
    max: max === null ? undefined : Number(max),
    tag: q.get("tag") ?? undefined,
    cd: q.get("cd") ?? undefined,
  };
}

/** `bytes=a-b` / `bytes=a-` / `bytes=-n`; dạng khác (nhiều khoảng, sai cú pháp) → bỏ qua, trả cả file. */
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] !== "" && Number(m[2]) < start) return null;
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start >= size ? "unsatisfiable" : { start, end };
}

export function createFilesRoutes(d: DiskDriver) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  });

  app.on(["GET", "HEAD"], "/:key{.+}", async (c) => {
    const key = keyOf(c, d);
    if (!key) return fail(c, 400, "invalid_key");
    const q = new URL(c.req.url).searchParams;
    const p = sigParams("GET", key, q);
    if (!d.verify(p, q.get("sig") ?? "")) return fail(c, 403, "forbidden");
    const s = await d.stat(key);
    if (!s) return fail(c, 404, "not_found");

    c.header("Content-Type", s.contentType ?? "application/octet-stream");
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    c.header("Cache-Control", `private, max-age=${Math.max(0, p.exp - d.nowS())}`);
    if (p.cd) c.header("Content-Disposition", p.cd);

    const range = parseRange(c.req.header("range"), s.bytes);
    if (range === "unsatisfiable") {
      c.header("Content-Range", `bytes */${s.bytes}`);
      return fail(c, 416, "range_not_satisfiable");
    }
    const status = range ? 206 : 200;
    if (range) c.header("Content-Range", `bytes ${range.start}-${range.end}/${s.bytes}`);
    c.header("Content-Length", String(range ? range.end - range.start + 1 : s.bytes));
    if (c.req.method === "HEAD") return c.body(null, status);
    return c.body(d.openRead(key, range ?? undefined), status);
  });

  app.put("/:key{.+}", async (c) => {
    const key = keyOf(c, d);
    if (!key) return fail(c, 400, "invalid_key");
    const q = new URL(c.req.url).searchParams;
    const p = sigParams("PUT", key, q);
    if (!d.verify(p, q.get("sig") ?? "")) return fail(c, 403, "forbidden");
    if (p.ct !== undefined && c.req.header("content-type") !== p.ct) return fail(c, 403, "content_type_mismatch");
    if (p.tag !== undefined && c.req.header("x-amz-tagging") !== p.tag) return fail(c, 403, "tagging_mismatch");
    await d.writeAtomic(key, c.req.raw.body, p.ct ?? "application/octet-stream");
    return c.body(null, 200);
  });

  app.post("/:key{.+}", async (c) => {
    const key = keyOf(c, d);
    if (!key) return fail(c, 400, "invalid_key");
    const q = new URL(c.req.url).searchParams;
    const p = sigParams("POST", key, q);
    if (!d.verify(p, q.get("sig") ?? "") || p.ct === undefined || p.max === undefined) {
      return fail(c, 403, "forbidden");
    }
    // Chặn trước khi đọc body vào RAM (parseBody đọc cả form).
    const len = c.req.header("content-length");
    if (!len || !/^\d+$/.test(len)) return fail(c, 411, "length_required");
    if (Number(len) > p.max + POST_OVERHEAD) return fail(c, 413, "too_large");

    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      return fail(c, 400, "bad_multipart");
    }
    if (form["Content-Type"] !== p.ct) return fail(c, 403, "content_type_mismatch");
    const file = form.file;
    if (!(file instanceof File)) return fail(c, 400, "missing_file");
    if (file.size < 1 || file.size > p.max) return fail(c, 400, "size_out_of_range");
    await d.writeAtomic(key, file.stream(), p.ct);
    return c.body(null, 204);
  });

  return app;
}
