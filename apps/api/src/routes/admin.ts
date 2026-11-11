import { Hono } from "hono";
import { requireAdmin } from "../middleware/admin.ts";
import { type AppEnv, requireUser } from "../middleware/user.ts";
import { adminFontRoutes } from "./admin-fonts.ts";
import { adminProviderRoutes } from "./admin-providers.ts";
import { adminSettingsRoutes } from "./admin-settings.ts";
import { adminUpdateRoutes } from "./admin-update.ts";
import { adminUserRoutes } from "./admin-users.ts";

/** Router quản trị (mount ở /api/admin): đăng nhập + email thuộc ADMIN_EMAILS. Export cho test tự liệt kê route. */
export function adminApi() {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);
  app.use("*", requireAdmin);
  app.route("/", adminSettingsRoutes);
  app.route("/", adminProviderRoutes);
  app.route("/", adminUserRoutes);
  app.route("/", adminFontRoutes);
  app.route("/", adminUpdateRoutes);
  return app;
}
