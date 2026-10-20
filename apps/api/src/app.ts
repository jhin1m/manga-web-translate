import { NotFoundError } from "@mtl/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";

export function createApp() {
  const app = new Hono();
  app.use("*", secureHeaders());

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Route người dùng: /api/me/* và /api/w/:ws/* (workspace trên URL).
  app.route("/api", workspaceRoutes);
  app.route("/api", uploadRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: "not_found", message: err.message }, 404);
    if (err instanceof HTTPException) {
      if (err.res) return err.res;
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
