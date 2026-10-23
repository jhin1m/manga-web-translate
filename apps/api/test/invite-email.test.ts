/** Email lời mời: gửi qua transport giả, fallback log, env, quyền gửi lại. */
import nodemailer from "nodemailer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INVITATION_HEADER, INVITATION_TOKEN_HEADER } from "../src/auth.ts";
import { env, parseEnv } from "../src/env.ts";
import { inviteEmail } from "../src/lib/invite-email.ts";
import { verifyInvitationToken } from "../src/lib/invite-token.ts";
import { describeMailError } from "../src/lib/mailer.ts";
import { call, cookieFrom, invite, PASSWORD, seedWorkspace, uniq } from "./helpers.ts";

const SMTP_URL = "smtps://mailer:s3cret-pw@smtp.example.test:465";
let A: Awaited<ReturnType<typeof seedWorkspace>>;
beforeAll(async () => {
  A = await seedWorkspace("mail");
});

type Sent = { from: string; to: string; subject: string; text: string; html: string };

/** Bật SMTP với transport giả; `fail` làm sendMail ném lỗi. */
function useFakeSmtp(fail?: Error) {
  env.SMTP_URL = SMTP_URL;
  env.MAIL_FROM = "MTL <no-reply@example.test>";
  const sent: Sent[] = [];
  const sendMail = vi.fn(async (m: Sent) => {
    if (fail) throw fail;
    sent.push(m);
    return {};
  });
  vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close: () => {} } as never);
  return { sent, sendMail };
}

afterEach(() => {
  env.SMTP_URL = undefined;
  env.MAIL_FROM = undefined;
  vi.restoreAllMocks();
});

const linkOf = (text: string) => new URL(text.match(/https?:\/\/\S+/)?.[0] ?? "");
const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

describe("invitation email", () => {
  it("sends exactly one mail with a valid accept link and does not log the link", async () => {
    const { sent } = useFakeSmtp();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const email = `${uniq("guest")}@example.com`;
    const id = await invite(A.cookie, A.workspaceId, email, "admin");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(email);
    expect(sent[0]?.from).toBe("MTL <no-reply@example.test>");
    expect(sent[0]?.text).toContain("WS mail");
    expect(sent[0]?.text).toContain("quản trị viên");
    const linkRes = await call(`/api/w/${A.workspaceId}/invitations/${id}/link`, { cookie: A.cookie });
    expect(await linkRes.json()).toMatchObject({ mail_enabled: true, mail_sent: true });
    const url = linkOf(sent[0]?.text ?? "");
    expect(url.searchParams.get("id")).toBe(id);
    expect(verifyInvitationToken(id, url.searchParams.get("token") ?? "")).toBe(true);
    expect(logged(info)).not.toContain("token=");

    // Link trong mail đăng ký được thật.
    const res = await call("/api/auth/sign-up/email", {
      method: "POST",
      body: { email, password: PASSWORD, name: "G" },
      headers: { [INVITATION_HEADER]: id, [INVITATION_TOKEN_HEADER]: url.searchParams.get("token") ?? "" },
    });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).not.toBe("");
  });

  it("without SMTP the invitation is created and the link is logged", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const create = vi.spyOn(nodemailer, "createTransport");
    const id = await invite(A.cookie, A.workspaceId, `${uniq("nosmtp")}@example.com`);
    expect(create).not.toHaveBeenCalled();
    expect(logged(info)).toContain(`id=${id}&token=`);
    const res = await call(`/api/w/${A.workspaceId}/invitations/${id}/link`, { cookie: A.cookie });
    expect(await res.json()).toMatchObject({ mail_enabled: false, mail_sent: false });
  });

  it("transport failure keeps the invitation (200), logs the link and never the SMTP password", async () => {
    useFakeSmtp(new Error(`auth failed for mailer:s3cret-pw@smtp.example.test`));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await invite(A.cookie, A.workspaceId, `${uniq("fail")}@example.com`);
    expect(logged(info)).toContain(`id=${id}&token=`);
    expect(logged(error)).toContain("lỗi");
    expect(logged(error)).not.toContain("s3cret-pw");
    const res = await call(`/api/w/${A.workspaceId}/invitations/${id}/link`, { cookie: A.cookie });
    expect(await res.json()).toMatchObject({ mail_enabled: true, mail_sent: false });
  });

  it("a malformed %-escape in the SMTP password neither breaks the invitation nor leaks the password", async () => {
    useFakeSmtp(new Error("auth failed for ab%zz"));
    env.SMTP_URL = "smtps://mailer:ab%zz@smtp.example.test:465";
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeMailError(new Error("bad login ab%zz"))).toBe("bad login ***");
    const id = await invite(A.cookie, A.workspaceId, `${uniq("pct")}@example.com`);
    expect(id).toBeTruthy();
    expect(logged(error)).not.toContain("ab%zz");
  });

  it("resend works for owner/admin only and sends a second mail with the same link", async () => {
    const { sent } = useFakeSmtp();
    const email = `${uniq("again")}@example.com`;
    const id = await invite(A.cookie, A.workspaceId, email);
    const resend = (cookie: string) =>
      call("/api/auth/organization/invite-member", {
        method: "POST",
        cookie,
        body: { email, role: "member", organizationId: A.workspaceId, resend: true },
      });

    const ok = await resend(A.cookie);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { id: string }).id).toBe(id);
    expect(sent).toHaveLength(2);
    expect(linkOf(sent[1]?.text ?? "").searchParams.get("id")).toBe(id);

    // Thành viên thường không gửi lại được.
    const memberEmail = `${uniq("plain")}@example.com`;
    const memberInv = await invite(A.cookie, A.workspaceId, memberEmail);
    const token = linkOf(sent.at(-1)?.text ?? "").searchParams.get("token") ?? "";
    const signUp = await call("/api/auth/sign-up/email", {
      method: "POST",
      body: { email: memberEmail, password: PASSWORD, name: "M" },
      headers: { [INVITATION_HEADER]: memberInv, [INVITATION_TOKEN_HEADER]: token },
    });
    const cookie = cookieFrom(signUp);
    await call("/api/auth/organization/accept-invitation", {
      method: "POST",
      cookie,
      body: { invitationId: memberInv },
    });
    const before = sent.length;
    expect((await resend(cookie)).status).toBe(403);
    expect(sent).toHaveLength(before);
  });
});

describe("invite email content", () => {
  it("escapes user-controlled values in html", () => {
    const m = inviteEmail({
      to: "a@b.c",
      workspaceName: '<script>alert("x")</script>',
      inviterName: "Eve & <b>Co</b>",
      role: "member",
      link: "https://x.test/accept-invite?id=1&token=2",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Co</b>");
    expect(m.html).toContain("&amp;token=2");
    expect(m.subject).toContain("Eve");
  });

  it("names the role in Vietnamese", () => {
    const base = { to: "a@b.c", workspaceName: "W", inviterName: "I", link: "https://x.test", expiresAt: new Date() };
    expect(inviteEmail({ ...base, role: "member" }).text).toContain("vai trò thành viên");
    expect(inviteEmail({ ...base, role: "admin" }).html).toContain("<strong>quản trị viên</strong>");
  });
});

describe("mail env", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5432/d",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost:5180",
    WEB_ORIGIN: "http://localhost:5180",
    S3_ENDPOINT: "http://localhost:9200",
    S3_BUCKET: "b",
    S3_ACCESS_KEY: "k",
    S3_SECRET_KEY: "s",
    FILES_DOMAIN: "localhost:9100",
  };

  it("requires MAIL_FROM when SMTP_URL is set", () => {
    expect(() => parseEnv({ ...base, SMTP_URL: SMTP_URL })).toThrow(/MAIL_FROM/);
    expect(parseEnv({ ...base, SMTP_URL, MAIL_FROM: "a@b.c" }).SMTP_URL).toBe(SMTP_URL);
    expect(parseEnv({ ...base, SMTP_URL: "", MAIL_FROM: "" }).SMTP_URL).toBeUndefined();
    expect(() => parseEnv({ ...base, SMTP_URL: "http://x.test", MAIL_FROM: "a@b.c" })).toThrow(/smtp/);
  });
});
