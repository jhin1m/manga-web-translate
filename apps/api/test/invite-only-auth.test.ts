/** Đăng ký chỉ qua lời mời — kiểm ở server bằng cách gọi thẳng API better-auth. */
import { invitation } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { INVITATION_HEADER, INVITATION_TOKEN_HEADER } from "../src/auth.ts";
import { invitationToken } from "../src/lib/invite-token.ts";
import { call, cookieFrom, db, invite, PASSWORD, seedWorkspace, uniq } from "./helpers.ts";

let A: Awaited<ReturnType<typeof seedWorkspace>>;
beforeAll(async () => {
  A = await seedWorkspace("inv");
});

const signUp = (email: string, invitationId?: string, token?: string) =>
  call("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password: PASSWORD, name: "New" },
    headers: {
      ...(invitationId ? { [INVITATION_HEADER]: invitationId } : {}),
      ...(token ? { [INVITATION_TOKEN_HEADER]: token } : {}),
    },
  });

/** Link mời qua route admin → (id, token). */
async function linkOf(invitationId: string, cookie = A.cookie) {
  const res = await call(`/api/w/${A.workspaceId}/invitations/${invitationId}/link`, { cookie });
  if (res.status !== 200) return { status: res.status, token: "" };
  const url = new URL(((await res.json()) as { link: string }).link);
  expect(url.searchParams.get("id")).toBe(invitationId);
  return { status: 200, token: url.searchParams.get("token") ?? "" };
}

/** Thành viên thường của A (đã nhận lời mời). */
async function joinAsMember() {
  const email = `${uniq("member")}@example.com`;
  const id = await invite(A.cookie, A.workspaceId, email);
  const res = await signUp(email, id, (await linkOf(id)).token);
  expect(res.status, await res.clone().text()).toBe(200);
  const cookie = cookieFrom(res);
  const acc = await call("/api/auth/organization/accept-invitation", {
    method: "POST",
    cookie,
    body: { invitationId: id },
  });
  expect(acc.status, await acc.clone().text()).toBe(200);
  return cookie;
}

describe("invite-only sign-up", () => {
  it("rejects sign-up without an invitation", async () => {
    expect((await signUp(`${uniq("nobody")}@example.com`)).status).toBe(403);
  });

  it("rejects an invitation id without a valid token (ids are visible to members)", async () => {
    const email = `${uniq("invited")}@example.com`;
    const id = await invite(A.cookie, A.workspaceId, email);
    expect((await signUp(email, id)).status).toBe(403);
    expect((await signUp(email, id, "forged-token")).status).toBe(403);
    const otherId = await invite(A.cookie, A.workspaceId, `${uniq("other")}@example.com`);
    expect((await signUp(email, id, invitationToken(otherId))).status).toBe(403);
  });

  it("rejects a valid link used with another email, or a nonexistent invitation", async () => {
    const id = await invite(A.cookie, A.workspaceId, `${uniq("invited")}@example.com`);
    expect((await signUp(`${uniq("thief")}@example.com`, id, invitationToken(id))).status).toBe(403);
    const ghost = "00000000-0000-7000-8000-000000000000";
    expect((await signUp(`${uniq("x")}@example.com`, ghost, invitationToken(ghost))).status).toBe(403);
  });

  it("rejects an expired invitation", async () => {
    const email = `${uniq("late")}@example.com`;
    const id = await invite(A.cookie, A.workspaceId, email);
    const { token } = await linkOf(id);
    await db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, id));
    expect((await signUp(email, id, token)).status).toBe(403);
  });

  it("a member can see invitation ids but cannot get the link nor sign up as the invitee", async () => {
    const memberCookie = await joinAsMember();
    const target = `${uniq("boss")}@example.com`;
    const id = await invite(A.cookie, A.workspaceId, target, "admin");
    const listed = await call(`/api/auth/organization/list-invitations?organizationId=${A.workspaceId}`, {
      cookie: memberCookie,
    });
    if (listed.status === 200) {
      const ids = ((await listed.json()) as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(id);
    }
    expect((await linkOf(id, memberCookie)).status).toBe(403);
    expect((await signUp(target, id)).status).toBe(403);
  });

  it("invited user signs up via the link, accepts and becomes a member of that workspace only", async () => {
    const cookie = await joinAsMember();
    const ws = await call(`/api/w/${A.workspaceId}`, { cookie });
    expect(ws.status).toBe(200);
    expect(((await ws.json()) as { role: string }).role).toBe("member");

    const mine = (await (await call("/api/me/workspaces", { cookie })).json()) as { workspaces: { id: string }[] };
    expect(mine.workspaces.map((w) => w.id)).toEqual([A.workspaceId]);

    // member không đổi được cài đặt (cần admin), owner thì được.
    const patch = { method: "PATCH", body: { worker_mode: "modal" } };
    expect((await call(`/api/w/${A.workspaceId}/settings`, { ...patch, cookie })).status).toBe(403);
    expect((await call(`/api/w/${A.workspaceId}/settings`, { ...patch, cookie: A.cookie })).status).toBe(200);
  });

  it("signed-up user without accepting is not a member", async () => {
    const email = `${uniq("pending")}@example.com`;
    const id = await invite(A.cookie, A.workspaceId, email);
    const res = await signUp(email, id, (await linkOf(id)).token);
    expect(res.status).toBe(200);
    expect((await call(`/api/w/${A.workspaceId}`, { cookie: cookieFrom(res) })).status).toBe(403);
  });

  it("users cannot create a workspace themselves", async () => {
    const res = await call("/api/auth/organization/create", {
      method: "POST",
      cookie: A.cookie,
      body: { name: "Mine", slug: uniq("mine") },
    });
    expect(res.status).toBe(403);
  });
});
