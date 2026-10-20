/**
 * Log truy cập dạng JSON một dòng (stdout → journald ở production: `journalctl -u mtl-api -o cat | jq`).
 * Không ghi query string, header hay body (presigned/token/cookie không bao giờ vào log).
 */
import { createMiddleware } from "hono/factory";

export const requestLog = createMiddleware(async (c, next) => {
  const started = performance.now();
  await next();
  console.info(
    JSON.stringify({
      t: new Date().toISOString(),
      level: c.res.status >= 500 ? "error" : "info",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    }),
  );
});
