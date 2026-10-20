import { NotFoundError } from "@mtl/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth.ts";
import { chapterRoutes } from "./routes/chapters.ts";
import { glossaryRoutes } from "./routes/glossary.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { pageRoutes } from "./routes/pages.ts";
import { progressRoutes } from "./routes/progress.ts";
import { seriesRoutes } from "./routes/series.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { workerRoutes } from "./routes/worker.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";

export function createApp() {
  const app = new Hono();
  app.use("*", secureHeaders());

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Route người dùng: /api/me/* và /api/w/:ws/* (workspace trên URL).
  app.route("/api", workspaceRoutes);
  app.route("/api", uploadRoutes);
  app.route("/api", jobRoutes);
  app.route("/api", progressRoutes);
  app.route("/api", seriesRoutes);
  app.route("/api", chapterRoutes);
  app.route("/api", pageRoutes);
  app.route("/api", glossaryRoutes);

  // Worker (Bearer token worker, không cookie) — giao thức có fencing, xem jobs/queue.ts.
  app.route("/worker/v1", workerRoutes);

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
