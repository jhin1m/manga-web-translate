/**
 * API phục vụ luôn SPA đã build (`SPA_DIR`, self-host 1 container — cùng origin, không cần Caddy).
 * - File tĩnh có thật → trả file; `/assets/*` (tên có hash của Vite) cache 1 năm `immutable`.
 * - `/assets/*` không có file → 404 (không nhét index.html vào chỗ JS/CSS).
 * - GET còn lại (route phía client: `/s/…`, `/settings`…) → `index.html` `no-cache` để bản mới có hiệu lực ngay.
 * Đường dẫn của server (`/api`, `/worker`, `/files`, `/healthz`, `/readyz`) không bao giờ rơi vào SPA → 404 JSON như cũ.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

const SERVER_PATH_RE = /^\/(api|worker|files)(\/|$)|^\/(healthz|readyz)$/;

export const isServerPath = (path: string): boolean => SERVER_PATH_RE.test(path);

export function mountSpa(app: Hono, dir: string): void {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  // Header phải đặt TRƯỚC khi serveStatic dựng Response (`onFound` chạy sau, không vào phản hồi); không có file →
  // gỡ trong `onNotFound` để 404 của asset thiếu không mang cache 1 năm.
  const files = serveStatic({ root, onNotFound: (_path, c) => void c.header("cache-control", undefined) });

  app.get("*", async (c, next) => {
    if (isServerPath(c.req.path)) return next();
    c.header("cache-control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    return files(c, next);
  });

  app.get("*", async (c, next) => {
    // Asset thiếu (chunk của bản build cũ) → 404, không trả HTML cho request JS/CSS.
    if (isServerPath(c.req.path) || c.req.path.startsWith("/assets/")) return next();
    let html: string;
    try {
      html = await readFile(indexPath, "utf8");
    } catch {
      return next(); // build thiếu index.html → 404 JSON thay vì 500
    }
    c.header("cache-control", "no-cache");
    return c.html(html);
  });
}
