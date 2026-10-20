import { workspaceSettings } from "@mtl/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "../auth.ts";
import { parseJson } from "../lib/validate.ts";
import { pendingInvitationLink } from "../lib/workspace-admin.ts";
import { type AppEnv, requireSession, requireWorkspace } from "../middleware/workspace.ts";

export const workspaceRoutes = new Hono<AppEnv>();

/** Workspace của người đang đăng nhập (màn chọn workspace). */
workspaceRoutes.get("/me/workspaces", requireSession, async (c) => {
  const orgs = await auth.api.listOrganizations({ headers: c.req.raw.headers });
  return c.json({ workspaces: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug })) });
});

workspaceRoutes.get("/w/:ws", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const org = await auth.api.getFullOrganization({
    headers: c.req.raw.headers,
    query: { organizationId: c.get("workspaceId"), membersLimit: 1 },
  });
  const settings = await sdb.find(workspaceSettings);
  return c.json({
    id: c.get("workspaceId"),
    name: org?.name ?? "",
    slug: org?.slug ?? "",
    role: c.get("role"),
    settings: { worker_mode: settings?.workerMode ?? "mac" },
  });
});

const SettingsPatch = z.object({ worker_mode: z.enum(["mac", "modal"]) });

workspaceRoutes.patch("/w/:ws/settings", requireWorkspace("admin"), async (c) => {
  const body = await parseJson(c, SettingsPatch);
  const sdb = c.get("sdb");
  const [row] = await sdb.update(workspaceSettings, sql`true`, { workerMode: body.worker_mode });
  const saved = row ?? (await sdb.insert(workspaceSettings, { workerMode: body.worker_mode }));
  return c.json({ settings: { worker_mode: saved.workerMode } });
});

/** Link mời có token đăng ký — chỉ owner/admin (member thấy invitation id qua better-auth nhưng không có token). */
workspaceRoutes.get("/w/:ws/invitations/:invitationId/link", requireWorkspace("admin"), async (c) => {
  const link = await pendingInvitationLink(c.get("workspaceId"), c.req.param("invitationId"));
  return c.json({ link });
});
