import { NotFoundError } from "@mtl/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth.ts";
import { devAutoLoginEnabled, env } from "./env.ts";
import { requestLog } from "./lib/request-log.ts";
import { type AppEnv, requireUser } from "./middleware/user.ts";
import { chapterRoutes } from "./routes/chapters.ts";
import { type DevLogin, devAuthRoutes } from "./routes/dev-auth.ts";
import { exportRoutes } from "./routes/export.ts";
import { findReplaceRoutes } from "./routes/find-replace.ts";
import { fontRoutes } from "./routes/fonts.ts";
import { glossaryRoutes } from "./routes/glossary.ts";
import { healthRoutes } from "./routes/health.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { meRoutes } from "./routes/me.ts";
import { pageStateRoutes } from "./routes/page-state.ts";
import { pageRoutes } from "./routes/pages.ts";
import { progressRoutes } from "./routes/progress.ts";
import { proofreadRoutes } from "./routes/proofread.ts";
import { seriesRoutes } from "./routes/series.ts";
import { seriesIgnoreApplyRoutes } from "./routes/series-ignore-apply.ts";
import { seriesSkipImageRoutes } from "./routes/series-skip-images.ts";
import { uploadRoutes } from "./routes/uploads.ts";
import { workerRoutes } from "./routes/worker.ts";

const envDevLogin = (): DevLogin | false =>
  devAutoLoginEnabled(env)
    ? { email: env.DEV_AUTO_LOGIN_EMAIL ?? "", password: env.DEV_AUTO_LOGIN_PASSWORD ?? "" }
    : false;

/** `devAutoLogin`: tài khoản cho POST /api/dev/auto-login; false = không mount route (mặc định theo env). */
export function createApp({ devAutoLogin = envDevLogin() }: { devAutoLogin?: DevLogin | false } = {}) {
  const app = new Hono();
  if (env.NODE_ENV === "production") app.use("*", requestLog);
  app.use("*", secureHeaders());

  app.route("/", healthRoutes);

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  if (devAutoLogin) app.route("/api", devAuthRoutes(devAutoLogin));

  // Route người dùng: mọi đường dưới /api còn lại bắt buộc đăng nhập (requireUser gắn một lần ở đây, sau
  // auth/dev/health) — dữ liệu luôn của người đang đăng nhập.
  app.route("/api", userApi());

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

/** Router người dùng (mount ở /api). Export cho test cách ly tự liệt kê route. */
export function userApi() {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);
  app.route("/", meRoutes);
  app.route("/", uploadRoutes);
  app.route("/", jobRoutes);
  app.route("/", progressRoutes);
  app.route("/", seriesRoutes);
  app.route("/", seriesSkipImageRoutes);
  app.route("/", seriesIgnoreApplyRoutes);
  app.route("/", chapterRoutes);
  app.route("/", proofreadRoutes);
  app.route("/", pageRoutes);
  app.route("/", pageStateRoutes);
  app.route("/", glossaryRoutes);
  app.route("/", exportRoutes);
  app.route("/", findReplaceRoutes);
  app.route("/", fontRoutes);
  return app;
}
