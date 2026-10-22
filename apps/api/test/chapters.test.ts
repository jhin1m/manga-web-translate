/**
 * Luồng chương qua API người dùng + worker giả lập (giao thức có fencing): upload → commit → ingest →
 * giai đoạn 1/2 → review; chạy lại trang lỗi; dịch lại 1 trang với glossary mới; huỷ; khoá chương.
 */
import { chapters, glossaryEntries, jobs, pageStates, pages, scoped, series, sourceFiles } from "@mtl/db";
import { emptyPageState, pageId } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { INVITATION_HEADER, INVITATION_TOKEN_HEADER } from "../src/auth.ts";
import { deletePrefix, head } from "../src/storage.ts";
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
  // Xong bước 1 → chờ "Dịch" (không tự dịch); bấm Dịch 2 lần → lần sau 409.
  expect((await progress(chapterId)).chapter.status).toBe("prepared");
  expect(await claimFor(chapterId, "chapter.translate")).toEqual([]);
  await json(await api(`/chapters/${chapterId}/translate-prepared`, { method: "POST" }), 202);
  await json(await api(`/chapters/${chapterId}/translate-prepared`, { method: "POST" }), 409);
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

    const { pages } = await json<{
      pages: {
        ord: number;
        image: { kind: string; url: string };
        images: { original: string; clean: string | null };
      }[];
    }>(await api(`/chapters/${ch}/pages`), 200);
    expect(pages.map((x) => x.ord)).toEqual([0, 1, 2]);
    expect(pages.every((x) => x.image.kind === "clean")).toBe(true);
    // Cả ảnh gốc lẫn ảnh sạch cho canvas màn chương; `image` (thumbnail) = ảnh sạch.
    expect(pages.every((x) => x.images.clean === x.image.url && x.images.original.includes("/ingest/"))).toBe(true);
    const img = await fetch(pages[0]?.image.url ?? "");
    expect(img.status).toBe(200);
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("source-files gives signed original uploads in upload order before any page exists", async () => {
    const ch = await uploadChapter(2, "1.5");
    const { files } = await json<{ files: { ord: number; url: string }[] }>(
      await api(`/chapters/${ch}/source-files`),
      200,
    );
    expect(files.map((f) => f.ord)).toEqual([0, 1]);
    expect((await fetch(files[0]?.url ?? "")).status).toBe(200);
    // Không để job ingest treo cho các test claim sau.
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });

  it("partial_failed → retry-failed re-runs only the failed page and ends in review", async () => {
    const ch = await uploadChapter(3, "2");
    await ingestAndPrepare(ch, 1);
    // 2 page prepare xong, đã bấm Dịch → translate cho riêng chúng (neighbors).
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
    // Trang chạy lại xong bước 1 → chờ "Dịch" như chương mới.
    expect((await progress(ch)).chapter.status).toBe("prepared");
    await json(await api(`/chapters/${ch}/translate-prepared`, { method: "POST" }), 202);
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
  it("bumps settings_rev only when a translation field changes; rejects unsupported languages", async () => {
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
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: { source_lang: "th" } })).status).toBe(400);
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: {} })).status).toBe(400);

    const list = await json<{ series: { id: string; chapter_count: number }[] }>(await api("/series"), 200);
    expect(list.series.find((x) => x.id === s.id)?.chapter_count).toBe(0);
  });
});

describe("recent chapters", () => {
  type Recent = {
    chapters: {
      id: string;
      number: string;
      series_title: string;
      exported: boolean;
      lock_holder_is_me: boolean;
      page_counts: { total: number };
    }[];
  };

  it("orders by updated_at (own lock first), honours limit and open, carries series_title", async () => {
    const R = await seedWorkspace("recent");
    const sdb = scoped(db, R.workspaceId);
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    const mk = (number: string, min: number) =>
      sdb.insert(chapters, { seriesId: R.seriesId, number, createdAt: at(min), updatedAt: at(min) });
    const old = await mk("2", 30);
    const mid = await mk("3", 20);
    const fresh = await mk("4", 10);
    // Seed chapter "1" mới nhất theo updated_at (vừa tạo) → set về rất cũ để thứ tự xác định.
    await db
      .update(chapters)
      .set({ updatedAt: at(60) })
      .where(eq(chapters.id, R.chapterId));
    const get = async (qs: string) =>
      json<Recent>(await call(`/api/w/${R.workspaceId}/recent-chapters${qs}`, { cookie: R.cookie }), 200);

    const all = await get("");
    expect(all.chapters.map((c) => c.id)).toEqual([fresh.id, mid.id, old.id, R.chapterId]);
    expect(all.chapters[0]).toMatchObject({ series_title: "Series recent", lock_holder_is_me: false });
    expect(all.chapters[0]?.page_counts).toEqual({ total: 0, ready: 0, failed: 0, busy: 0 });
    expect((await get("?limit=2")).chapters.map((c) => c.id)).toEqual([fresh.id, mid.id]);
    expect((await call(`/api/w/${R.workspaceId}/recent-chapters?limit=0`, { cookie: R.cookie })).status).toBe(400);

    // Khoá của mình → đứng đầu dù updated_at cũ (lock bump updated_at nên ép lại cho chắc thứ tự).
    await json(
      await call(`/api/w/${R.workspaceId}/chapters/${old.id}/lock`, { method: "POST", cookie: R.cookie }),
      200,
    );
    await db
      .update(chapters)
      .set({ updatedAt: at(30) })
      .where(eq(chapters.id, old.id));
    const locked = await get("");
    expect(locked.chapters[0]).toMatchObject({ id: old.id, lock_holder_is_me: true });

    // open=1: bỏ chương done và chương đã có export thành công.
    await db.update(chapters).set({ status: "done" }).where(eq(chapters.id, mid.id));
    await sdb.insert(jobs, {
      type: "chapter.export",
      status: "succeeded",
      payload: {
        type: "chapter.export",
        chapter_id: fresh.id,
        format: "cbz",
        layout: "pages",
        quality: 90,
        include_untranslated: false,
      },
      inputRev: "x",
      idempotencyKey: uniq("export"),
      chapterId: fresh.id,
    });
    const open = await get("?open=1");
    expect(open.chapters.map((c) => c.id)).toEqual([old.id, R.chapterId]);
    expect((await get("")).chapters.find((c) => c.id === fresh.id)?.exported).toBe(true);
  });

  it("an exported chapter edited or retranslated afterwards needs re-export", async () => {
    const R = await seedWorkspace("reexport");
    const sdb = scoped(db, R.workspaceId);
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    const job = (chapterId: string, type: "chapter.export" | "chapter.translate", min: number) =>
      sdb.insert(jobs, {
        type,
        status: "succeeded",
        payload: { type } as never,
        inputRev: "x",
        idempotencyKey: uniq(type),
        chapterId,
        createdAt: at(min),
      });
    const withPage = async (number: string, editedMin: number) => {
      const ch = await sdb.insert(chapters, { seriesId: R.seriesId, number, status: "review" });
      const id = pageId(ch.id, 1, 0);
      await sdb.insert(pages, {
        id,
        chapterId: ch.id,
        ord: 0,
        width: 10,
        height: 10,
        originalKey: `ws/${R.workspaceId}/ch/${ch.id}/ingest/1/0.png`,
        originalSha256: "ab".repeat(32),
      });
      await sdb.insert(pageStates, { pageId: id, state: emptyPageState(10, 10), updatedAt: at(editedMin) });
      return ch.id;
    };
    const clean = await withPage("2", 30); // sửa trước lần xuất
    await job(clean, "chapter.export", 20);
    const edited = await withPage("3", 5); // sửa sau lần xuất
    await job(edited, "chapter.export", 20);
    const retranslated = await withPage("4", 30);
    await job(retranslated, "chapter.export", 20);
    await job(retranslated, "chapter.translate", 10);

    type Recent = { chapters: { id: string; exported: boolean; reexport: boolean }[] };
    const open = await json<Recent>(
      await call(`/api/w/${R.workspaceId}/recent-chapters?open=1`, { cookie: R.cookie }),
      200,
    );
    const ids = open.chapters.map((c) => c.id);
    expect(ids).not.toContain(clean);
    expect(open.chapters.find((c) => c.id === edited)).toMatchObject({ exported: false, reexport: true });
    expect(open.chapters.find((c) => c.id === retranslated)).toMatchObject({ exported: false, reexport: true });

    // Xuất lại → hết cần làm.
    await job(edited, "chapter.export", 0);
    const again = await json<Recent>(
      await call(`/api/w/${R.workspaceId}/recent-chapters?open=1`, { cookie: R.cookie }),
      200,
    );
    expect(again.chapters.map((c) => c.id)).not.toContain(edited);
    const d = await json<{ chapters: { id: string; exported: boolean; reexport: boolean }[] }>(
      await call(`/api/w/${R.workspaceId}/series/${R.seriesId}`, { cookie: R.cookie }),
      200,
    );
    expect(d.chapters.find((c) => c.id === clean)).toMatchObject({ exported: true, reexport: false });
    expect(d.chapters.find((c) => c.id === retranslated)).toMatchObject({ exported: false, reexport: true });
  });

  it("series detail and list carry page_counts / exported / next_number", async () => {
    const ch = await uploadChapter(3, "40");
    // Ingest còn treo của test trước (khoá chương) cũng được claim → xử lý hết để page của `ch` chắc chắn có.
    for (const j of await claimFor(ch, "chapter.ingest")) expect((await doIngest(token, j)).status).toBe(200);
    const failId = (await progress(ch)).pages[1]?.id;
    for (const j of await claimFor(ch, "page.prepare")) {
      const r = j.payload.page_id === failId ? await failJob(token, j, "invalid_input") : await doPrepare(token, j);
      expect(r.status).toBe(200);
    }
    type Detail = { chapters: { id: string; page_counts: Record<string, number>; exported: boolean }[] };
    const d = await json<Detail>(await api(`/series/${A.seriesId}`), 200);
    const row = d.chapters.find((c) => c.id === ch);
    expect(row?.page_counts).toEqual({ total: 3, ready: 0, failed: 1, busy: 2 });
    expect(row?.exported).toBe(false);

    type List = {
      series: { id: string; next_number: string; latest_chapter: { id: string; page_counts: object } | null }[];
    };
    const l = await json<List>(await api("/series"), 200);
    const s = l.series.find((x) => x.id === A.seriesId);
    expect(s?.next_number).toBe("41");
    expect(s?.latest_chapter?.id).toBe(ch);
  });
});

describe("edit chapter number / series", () => {
  it("renumbers, moves to another series of the workspace, rejects a taken number and foreign series", async () => {
    const R = await seedWorkspace("patch");
    const O = await seedWorkspace("patch-other");
    const sdb = scoped(db, R.workspaceId);
    const other = await sdb.insert(series, { title: "Series khác" });
    await sdb.insert(chapters, { seriesId: R.seriesId, number: "2" });
    await sdb.insert(chapters, { seriesId: other.id, number: "7" });
    const patch = (body: unknown, id = R.chapterId) =>
      call(`/api/w/${R.workspaceId}/chapters/${id}`, { method: "PATCH", cookie: R.cookie, body });
    type Summary = { id: string; series_id: string; number: string };

    expect(await json<Summary>(await patch({ number: "3" }), 200)).toMatchObject({
      number: "3",
      series_id: R.seriesId,
    });
    // Giữ nguyên số của chính nó: không phải trùng.
    await json(await patch({ number: "3.0" }), 200);
    const taken = await json<{ error: string }>(await patch({ number: "2" }), 409);
    expect(taken.error).toBe("chapter_number_taken");
    expect((await json<{ error: string }>(await patch({ series_id: other.id, number: "7" }), 409)).error).toBe(
      "chapter_number_taken",
    );

    const moved = await json<Summary>(await patch({ series_id: other.id, number: "8" }), 200);
    expect(moved).toMatchObject({ series_id: other.id, number: "8" });
    const detail = await json<{ series: { id: string } }>(
      await call(`/api/w/${R.workspaceId}/chapters/${R.chapterId}`, { cookie: R.cookie }),
      200,
    );
    expect(detail.series.id).toBe(other.id);

    // Series của workspace khác → 404, chương không đổi.
    expect((await patch({ series_id: O.seriesId })).status).toBe(404);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ number: "abc" })).status).toBe(400);
    const [row] = await sdb.select(chapters, eq(chapters.id, R.chapterId));
    expect(row).toMatchObject({ seriesId: other.id, number: "8" });
  });
});

describe("delete chapter / series", () => {
  it("removes a processed chapter with its jobs, pages and stored files; refuses while someone else edits", async () => {
    const ch = await uploadChapter(2, "601");
    await ingestAndPrepare(ch);
    const [src] = await db.select().from(sourceFiles).where(eq(sourceFiles.chapterId, ch));
    const pageIds = (await db.select().from(pages).where(eq(pages.chapterId, ch))).map((p) => p.id);
    expect(pageIds).toHaveLength(2);
    expect(await head(src?.storageKey ?? "")).not.toBeNull();

    await json(await api(`/chapters/${ch}/lock`, { method: "POST", cookie: memberCookie }), 200);
    const locked = await json<{ holder_name: string }>(await api(`/chapters/${ch}`, { method: "DELETE" }), 423);
    expect(locked.holder_name).toBe("Lan");
    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE", cookie: memberCookie })).status).toBe(204);

    expect((await api(`/chapters/${ch}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/chapters/${ch}`)).status).toBe(404);
    expect(await db.select().from(jobs).where(eq(jobs.chapterId, ch))).toEqual([]);
    expect(await db.select().from(pages).where(eq(pages.chapterId, ch))).toEqual([]);
    expect(await head(src?.storageKey ?? "")).toBeNull();
    // Không còn object nào dưới prefix của chương / page (deletePrefix đếm lại = 0).
    for (const p of [`ws/${A.workspaceId}/ch/${ch}/`, ...pageIds.map((id) => `ws/${A.workspaceId}/pg/${id}/`)]) {
      expect(await deletePrefix(p)).toBe(0);
    }
    expect((await api(`/chapters/${ch}`, { method: "DELETE" })).status).toBe(404);
  });

  it("deletes a series with its chapters and glossary (admin only, own workspace only)", async () => {
    const O = await seedWorkspace("del-other");
    const sdb = scoped(db, A.workspaceId);
    const s = await sdb.insert(series, { title: "Series xoá" });
    const ch = await sdb.insert(chapters, { seriesId: s.id, number: "1" });
    await sdb.insert(glossaryEntries, { seriesId: s.id, sourceTerm: "검", targetTerm: "kiếm" });

    expect((await api(`/series/${s.id}`, { method: "DELETE", cookie: memberCookie })).status).toBe(403);
    expect((await call(`/api/w/${O.workspaceId}/series/${s.id}`, { method: "DELETE", cookie: O.cookie })).status).toBe(
      404,
    );
    expect(
      (await call(`/api/w/${O.workspaceId}/chapters/${ch.id}`, { method: "DELETE", cookie: O.cookie })).status,
    ).toBe(404);

    expect((await api(`/series/${s.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/series/${s.id}`)).status).toBe(404);
    expect(await db.select().from(chapters).where(eq(chapters.seriesId, s.id))).toEqual([]);
    expect(await db.select().from(glossaryEntries).where(eq(glossaryEntries.seriesId, s.id))).toEqual([]);
  });
});
