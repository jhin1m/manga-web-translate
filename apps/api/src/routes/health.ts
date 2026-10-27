/** `GET /healthz` (không auth, không lộ dữ liệu người dùng): 200 khi DB + MinIO + runner ổn, ngược lại 503. */
import { Hono } from "hono";
import { checkHealth } from "../lib/health.ts";

export const healthRoutes = new Hono();

healthRoutes.get("/healthz", async (c) => {
  const h = await checkHealth();
  c.header("cache-control", "no-store");
  return c.json(h, h.ok ? 200 : 503);
});
