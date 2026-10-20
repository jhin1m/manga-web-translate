/**
 * Luồng chương qua API người dùng + worker giả lập (giao thức có fencing): upload → commit → ingest →
 * giai đoạn 1/2 → review; chạy lại trang lỗi; dịch lại 1 trang với glossary mới; huỷ; khoá chương.
 */
import { jobs } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { INVITATION_HEADER, INVITATION_TOKEN_HEADER } from "../src/auth.ts";
import { call, cookieFrom, db, invite, PASSWORD, seedWorkspace, uniq } from "./helpers.ts";
import {
  type Claimed,
  claimJobs,
  doIngest,
  doPrepare,
  doTranslate,
  failJob,
  makeRunnable,
  PNG_1PX,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
type Upload = { id: string; url: string; fields: Record<string, string> };
type Progress = {
  chapter: { status: string };
  counts: Record<string, number>;
  pages: { id: string; ord: number; status: string }[];
};

let A: Seed;
let token: string;
let memberCookie: string;

/** Thành viên thứ 2 của A (nhận lời mời qua link có token). */
async function joinAsMember(): Promise<string> {
  const email = `${uniq("member")}@example.com`;
  const id = await invite(A.cookie, A.workspaceId, email);
  const link = await call(`/api/w/${A.workspaceId}/invitations/${id}/link`, { cookie: A.cookie });
  const t = new URL(((await link.json()) as { link: string }).link).searchParams.get("token") ?? "";
  const res = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password: PASSWORD, name: "Lan" },
    headers: { [INVITATION_HEADER]: id, [INVITATION_TOKEN_HEADER]: t },
  });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  const acc = await call("/api/auth/organization/accept-invitation", {
    method: "POST",
    cookie,
    body: { invitationId: id },
  });
  expect(acc.status).toBe(200);
  return cookie;
}

beforeAll(async () => {
  A = await seedWorkspace("chap");
  token = (await workerToken(A.workspaceId, "chapters-test")).token;
  memberCookie = await joinAsMember();
});

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  call(`/api/w/${A.workspaceId}${path}`, { cookie: A.cookie, ...init });

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function postFile(u: Upload, body: Uint8Array) {
  const form = new FormData();
  for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
  form.append("file", new Blob([body]));
  const res = await fetch(u.url, { method: "POST", body: form });
  expect(res.status).toBe(204);
}

/** Tạo chương n trang qua API, upload PNG thật, commit. */
async function uploadChapter(n: number, number: string) {
  const files = Array.from({ length: n }, (_, i) => ({
    name: `${i + 1}.png`,
    content_type: "image/png",
    bytes: PNG_1PX.length,
  }));
  const created = await json<{ chapter: { id: string }; files: Upload[] }>(
    await api("/chapters", { method: "POST", body: { series_id: A.seriesId, number, files } }),
    201,
  );
  await Promise.all(created.files.map((f) => postFile(f, PNG_1PX)));
  await json(await api(`/chapters/${created.chapter.id}/commit`, { method: "POST", body: {} }), 202);
  return created.chapter.id;
}

const progress = async (chapterId: string) => json<Progress>(await api(`/chapters/${chapterId}/progress`), 200);

/** Worker giả (token riêng workspace A, test chạy tuần tự): claim 1 loại job. */
async function claimFor(_chapterId: string, type: string, max = 8): Promise<Claimed[]> {
  await makeRunnable();
  return claimJobs(token, { caps: [type], max });
}

async function ingestAndPrepare(chapterId: string, failOrd?: number) {
  const [ij] = await claimFor(chapterId, "chapter.ingest", 1);
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
  const prep = await claimFor(chapterId, "page.prepare");
  const p = await progress(chapterId);
  const failId = failOrd === undefined ? undefined : p.pages[failOrd]?.id;
  for (const j of prep) {
    const r = j.payload.page_id === failId ? await failJob(token, j, "invalid_input") : await doPrepare(token, j);
    expect(r.status).toBe(200);
  }
}

describe("chapter flow", () => {
  it("upload → commit → ingest → prepare → translate → review; pages give signed clean images", async () => {
    const ch = await uploadChapter(3, "1");
    expect((await progress(ch)).chapter.status).toBe("ingesting");
    await ingestAndPrepare(ch);
    const [tj] = await claimFor(ch, "chapter.translate", 1);
    expect(tj?.payload.context).toBe("rolling");
    expect((await doTranslate(token, tj as Claimed)).status).toBe(200);

    const p = await progress(ch);
    expect(p.chapter.status).toBe("review");
    expect(p.counts.ready).toBe(3);

    const { pages } = await json<{ pages: { ord: number; image: { kind: string; url: string } }[] }>(
      await api(`/chapters/${ch}/pages`),
      200,
    );
    expect(pages.map((x) => x.ord)).toEqual([0, 1, 2]);
    expect(pages.every((x) => x.image.kind === "clean")).toBe(true);
    const img = await fetch(pages[0]?.image.url ?? "");
    expect(img.status).toBe(200);
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("partial_failed → retry-failed re-runs only the failed page and ends in review", async () => {
    const ch = await uploadChapter(3, "2");
    await ingestAndPrepare(ch, 1);
    // 2 page prepare xong → translate cho riêng chúng (neighbors).
    const [tj] = await claimFor(ch, "chapter.translate", 1);
    expect(tj?.payload.context).toBe("neighbors");
    expect((await doTranslate(token, tj as Claimed)).status).toBe(200);
    expect((await progress(ch)).chapter.status).toBe("partial_failed");

    const { jobs: created } = await json<{ jobs: { type: string }[] }>(
      await api(`/chapters/${ch}/retry-failed`, { method: "POST" }),
      202,
    );
    expect(created.map((j) => j.type)).toEqual(["page.prepare"]);
    const [pj] = await claimFor(ch, "page.prepare", 5);
    expect((await doPrepare(token, pj as Claimed)).status).toBe(200);
    const [tj2] = await claimFor(ch, "chapter.translate", 1);
    expect(tj2?.payload.page_ids).toHaveLength(1);
    expect((await doTranslate(token, tj2 as Claimed)).status).toBe(200);
    const p = await progress(ch);
    expect(p.chapter.status).toBe("review");
    expect(p.counts.ready).toBe(3);
  });

  it("retranslating one page after a glossary change snapshots the new term + rev, with neighbor context", async () => {
    const ch = await uploadChapter(3, "3");
    await ingestAndPrepare(ch);
    const [tj] = await claimFor(ch, "chapter.translate", 1);
    expect((await doTranslate(token, tj as Claimed)).status).toBe(200);

    const before = await json<{ glossary_rev: number }>(await api(`/series/${A.seriesId}`), 200);
    await json(
      await api(`/series/${A.seriesId}/glossary`, {
        method: "POST",
        body: { source_term: "안녕하세요", target_term: "Chào cậu" },
      }),
      201,
    );
    const p = await progress(ch);
    const mid = p.pages[1]?.id as string;
    const { job } = await json<{ job: { id: string } }>(
      await api(`/chapters/${ch}/translate`, { method: "POST", body: { page_ids: [mid] } }),
      202,
    );
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    const payload = row?.payload as { context: string; glossary_rev: number; settings: { glossary: object } };
    expect(payload.context).toBe("neighbors");
    expect(payload.glossary_rev).toBe(before.glossary_rev + 1);
    expect(payload.settings.glossary).toMatchObject({ 안녕하세요: "Chào cậu" });
    // Ngữ cảnh trang lân cận có trong inputs lúc claim.
    const [tj2] = await claimFor(ch, "chapter.translate", 1);
    expect(tj2?.id).toBe(job.id);
    const inputs = tj2?.inputs as { pages: { page_id: string }[]; context_lines: unknown[] };
    expect(inputs.pages.map((x) => x.page_id)).toEqual([mid]);
    expect(inputs.context_lines.length).toBeGreaterThan(0);
  });

  it("cancel stops every active job of the chapter", async () => {
    const ch = await uploadChapter(2, "4");
    const [ij] = await claimFor(ch, "chapter.ingest", 1);
    expect((await doIngest(token, ij as Claimed)).status).toBe(200);
    const out = await json<{ cancelled: number; chapter: { status: string } }>(
      await api(`/chapters/${ch}/cancel`, { method: "POST" }),
      200,
    );
    expect(out.cancelled).toBeGreaterThanOrEqual(2);
    const left = await db.select().from(jobs).where(eq(jobs.chapterId, ch));
    expect(left.filter((j) => ["queued", "running", "paused_budget"].includes(j.status))).toEqual([]);
    expect(out.chapter.status).toBe("partial_failed");
  });
});

describe("chapter lock", () => {
  it("second user sees the holder; writing while not holding → 423; release frees it", async () => {
    const files = [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }];
    const { chapter, files: ups } = await json<{ chapter: { id: string }; files: Upload[] }>(
      await api("/chapters", { method: "POST", body: { series_id: A.seriesId, number: "5", files } }),
      201,
    );
    await postFile(ups[0] as Upload, PNG_1PX);
    const ch = chapter.id;

    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);
    const denied = await json<{ holder_name: string }>(
      await api(`/chapters/${ch}/lock`, { method: "POST", cookie: memberCookie }),
      423,
    );
    expect(denied.holder_name).toBe("chap");
    const seen = await json<{ lock: { holder_name: string; is_me: boolean } }>(
      await api(`/chapters/${ch}`, { cookie: memberCookie }),
      200,
    );
    expect(seen.lock).toMatchObject({ holder_name: "chap", is_me: false });
    // Ghi nội dung chương khi người khác giữ khoá → 423.
    expect((await api(`/chapters/${ch}/commit`, { method: "POST", body: {}, cookie: memberCookie })).status).toBe(423);
    // Heartbeat của chính người giữ vẫn được.
    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);

    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE" })).status).toBe(204);
    await json(await api(`/chapters/${ch}/lock`, { method: "POST", cookie: memberCookie }), 200);
    expect((await api(`/chapters/${ch}/commit`, { method: "POST", body: {}, cookie: memberCookie })).status).toBe(202);
  });
});

describe("series settings", () => {
  it("bumps settings_rev only when a translation field changes; MVP only accepts ko", async () => {
    const s = await json<{ id: string; settings_rev: number; llm_tier: string }>(
      await api("/series", { method: "POST", body: { title: "Rev test" } }),
      201,
    );
    expect(s.llm_tier).toBe("standard");
    const t1 = await json<{ settings_rev: number }>(
      await api(`/series/${s.id}`, { method: "PATCH", body: { title: "Renamed" } }),
      200,
    );
    expect(t1.settings_rev).toBe(s.settings_rev);
    const t2 = await json<{ settings_rev: number; pronoun_rules: unknown[] }>(
      await api(`/series/${s.id}`, {
        method: "PATCH",
        body: { pronoun_rules: [{ speaker: "Minh", listener: "Lan", address: "anh/em" }], honorific_policy: "keep" },
      }),
      200,
    );
    expect(t2.settings_rev).toBe(s.settings_rev + 1);
    expect(t2.pronoun_rules).toEqual([{ speaker: "Minh", listener: "Lan", address: "anh/em", note: "" }]);
    // Lưu lại y nguyên → không tăng.
    const t3 = await json<{ settings_rev: number }>(
      await api(`/series/${s.id}`, { method: "PATCH", body: { honorific_policy: "keep" } }),
      200,
    );
    expect(t3.settings_rev).toBe(t2.settings_rev);
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: { source_lang: "ja" } })).status).toBe(400);
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: {} })).status).toBe(400);

    const list = await json<{ series: { id: string; chapter_count: number }[] }>(await api("/series"), 200);
    expect(list.series.find((x) => x.id === s.id)?.chapter_count).toBe(0);
  });
});
