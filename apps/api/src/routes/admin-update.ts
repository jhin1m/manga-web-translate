import { isPrerelease, parseVersion, type UpdateStatus } from "@mtl/shared/update";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { env } from "../env.ts";
import { getUpdateCheck, updateAvailable } from "../lib/update-check.ts";
import { startUpdate, updaterStatus } from "../lib/updater-client.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

/**
 * Cập nhật self-host trong app (chỉ local mode; bản VPS cập nhật bằng infra/deploy.sh). App không có Docker socket:
 * chỉ hỏi GitHub (cache) và nhờ service `updater` bắt đầu cập nhật.
 */
export const adminUpdateRoutes = new Hono<AppEnv>();

const COOLDOWN_MS = 60_000;
let lastTriggerAt = 0;

/** Test đặt lại cooldown giữa các ca. */
export function resetUpdateCooldownForTest(): void {
  lastTriggerAt = 0;
}

/** Đang ghim phiên bản khi compose truyền MTL_TAG khác `latest`. */
const pinnedTag = (): string | null => (env.MTL_TAG && env.MTL_TAG !== "latest" ? env.MTL_TAG : null);

const err = (code: string, status: ContentfulStatusCode) => Response.json({ error: code, reason: code }, { status });

adminUpdateRoutes.get("/update", async (c) => {
  if (!env.MTL_LOCAL_MODE) return c.json({ error: "not_found" }, 404);
  const check = getUpdateCheck();
  const [result, updater] = await Promise.all([check.get(), updaterStatus()]);
  const body: UpdateStatus = {
    current: check.current,
    check: result.check,
    latest: result.latest,
    update_available: updateAvailable(check.current, result),
    pinned_tag: pinnedTag(),
    updater,
  };
  c.header("cache-control", "no-store");
  return c.json(body);
});

const StartBody = z.object({ version: z.string().max(64) });

adminUpdateRoutes.post("/update", async (c) => {
  if (!env.MTL_LOCAL_MODE) return c.json({ error: "not_found" }, 404);
  // Form HTML cross-site không gửi được JSON nếu không có preflight.
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return err("unsupported_media_type", 415);
  }
  const { version: raw } = await parseJson(c, StartBody);
  if (!parseVersion(raw)) return err("bad_version", 400);
  const version = raw.startsWith("v") ? raw.slice(1) : raw;

  // Hỏi lại GitHub một lần (bỏ cache): web có thể đang hiện bản cũ, hoặc `latest` đã sang bản mới hơn.
  const check = getUpdateCheck();
  const result = await check.get({ fresh: true });
  if (!updateAvailable(check.current, result) || result.latest?.version !== version) return err("stale", 409);

  if (pinnedTag() && !isPrerelease(version)) return err("pinned", 422);

  // Đặt mốc trước khi chờ updater để hai request song song không cùng qua cooldown.
  const now = Date.now();
  if (now - lastTriggerAt < COOLDOWN_MS) return err("cooldown", 429);
  const previous = lastTriggerAt;
  lastTriggerAt = now;

  const started = await startUpdate(version);
  if (!started.ok) {
    lastTriggerAt = previous;
    return err(started.reason, started.status as ContentfulStatusCode);
  }
  console.log(`[update] ${check.current} → ${version}`);
  return c.json({ run: started.run }, 202);
});
