/**
 * `GET /healthz` (không auth, không lộ dữ liệu người dùng): 200 khi DB + storage + runner ổn, ngược lại 503.
 * `GET /readyz`: 200 khi DB + storage ổn (không xét runner) — healthcheck compose của app; dùng /healthz sẽ kẹt vì
 * runner (`jobs`) chỉ khởi động sau khi app healthy.
 */
import { Hono } from "hono";
import { checkHealth, checkReady } from "../lib/health.ts";

export const healthRoutes = new Hono();

healthRoutes.get("/healthz", async (c) => {
  const h = await checkHealth();
  c.header("cache-control", "no-store");
  return c.json(h, h.ok ? 200 : 503);
});

healthRoutes.get("/readyz", async (c) => {
  const r = await checkReady();
  c.header("cache-control", "no-store");
  return c.json(r, r.ok ? 200 : 503);
});
