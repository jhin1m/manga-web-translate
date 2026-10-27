import { chapters, scoped, series } from "@mtl/db";
import { v7 as uuidv7 } from "uuid";
import { createApp } from "../src/app.ts";
import { auth } from "../src/auth.ts";
import { db } from "../src/db.ts";
import { env } from "../src/env.ts";
import { createUser } from "../src/lib/create-user.ts";

export const app = createApp();
export const PASSWORD = "test-password-123";

/** Gọi app như trình duyệt cùng origin (better-auth kiểm Origin cho POST có cookie). */
export function call(
  path: string,
  init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { origin: env.WEB_ORIGIN, ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Cookie phiên từ header set-cookie. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function signIn(email: string, password = PASSWORD): Promise<string> {
  const res = await call("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
  if (res.status !== 200) throw new Error(`sign-in ${email} failed: ${res.status} ${await res.text()}`);
  return cookieFrom(res);
}

export const uniq = (p: string) => `${p}-${uuidv7().slice(-12)}`;

/** Người dùng đăng nhập sẵn + 1 series + 1 chapter. */
export async function seedUser(label: string) {
  const email = `${uniq(label)}@example.com`;
  const { userId } = await createUser({ email, name: label, password: PASSWORD });
  const sdb = scoped(db, userId);
  const s = await sdb.insert(series, { title: `Series ${label}` });
  const ch = await sdb.insert(chapters, { seriesId: s.id, number: "1" });
  const cookie = await signIn(email);
  return { userId, email, cookie, seriesId: s.id, chapterId: ch.id };
}

export { auth, db };
