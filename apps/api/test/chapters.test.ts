/**
 * Luồng chương qua API người dùng + worker giả lập (giao thức có fencing): upload → commit → ingest →
 * giai đoạn 1/2 → review; chạy lại trang lỗi; dịch lại 1 trang với glossary mới; huỷ; khoá chương.
 */
import { chapters, glossaryEntries, jobs, pageStates, pages, scoped, series, sourceFiles } from "@mtl/db";
import { emptyPageState, pageId } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deletePrefix, head } from "../src/storage.ts";
import { call, db, seedUser, uniq } from "./helpers.ts";
import {
  aiState,
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

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Upload = { id: string; url: string; fields: Record<string, string> };
type Progress = {
  chapter: { status: string };
  counts: Record<string, number>;
  pages: { id: string; ord: number; status: string; skipped: boolean; job: { type: string; status: string } | null }[];
};

let A: Seed;
let token: string;
/** Tab thứ 2 của cùng người dùng (khoá chương giữ theo tab). */
const TAB_B = { "x-tab-id": "tab-b" };

beforeAll(async () => {
  A = await seedUser("chap");
  token = (await workerToken("mac", "chapters-test")).token;
});

const api = (
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) => call(`/api${path}`, { cookie: A.cookie, ...init });

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

/** Worker giả (token Mac, test chạy tuần tự): claim 1 loại job. */
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
    // Job dịch còn xếp hàng: page vẫn `prepared` nhưng tiến độ gắn job dịch cấp chương cho từng page (rail hiện "Đang dịch").
    const queued = await progress(ch);
    expect(queued.pages.map((p) => [p.status, p.job?.type, p.job?.status])).toEqual(
      Array(3).fill(["prepared", "chapter.translate", "queued"]),
    );
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
    // Chương đã có trang dịch xong → trang chạy lại vào lượt dịch, xong bước 1 là tự dịch tiếp.
    expect((await progress(ch)).chapter.status).toBe("processing");
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
  it("another tab is refused (423) and only reads; writing while not holding → 423; release frees it", async () => {
    const files = [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }];
    const { chapter, files: ups } = await json<{ chapter: { id: string }; files: Upload[] }>(
      await api("/chapters", { method: "POST", body: { series_id: A.seriesId, number: "5", files } }),
      201,
    );
    await postFile(ups[0] as Upload, PNG_1PX);
    const ch = chapter.id;

    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);
    const denied = await json<Record<string, unknown>>(
      await api(`/chapters/${ch}/lock`, { method: "POST", headers: TAB_B }),
      423,
    );
    expect(denied).toEqual({ error: "chapter_locked" });
    const seen = await json<{ lock: Record<string, unknown> | null }>(
      await api(`/chapters/${ch}`, { headers: TAB_B }),
      200,
    );
    expect(Object.keys(seen.lock ?? {})).toEqual(["expires_at"]);
    // Ghi nội dung chương khi tab khác giữ khoá → 423.
    expect((await api(`/chapters/${ch}/commit`, { method: "POST", body: {}, headers: TAB_B })).status).toBe(423);
    // Tab B đóng (nhả khoá) không nhả khoá của tab đang giữ; heartbeat của tab giữ vẫn được.
    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE", headers: TAB_B })).status).toBe(204);
    expect((await api(`/chapters/${ch}/lock`, { method: "POST", headers: TAB_B })).status).toBe(423);
    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);

    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE" })).status).toBe(204);
    await json(await api(`/chapters/${ch}/lock`, { method: "POST", headers: TAB_B }), 200);
    expect((await api(`/chapters/${ch}/commit`, { method: "POST", body: {}, headers: TAB_B })).status).toBe(202);
  });
});

describe("skip source files before step 1", () => {
  /** Chương nháp n ảnh đã upload (chưa commit). */
  async function draftChapter(n: number, number: string) {
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
    return { ch: created.chapter.id, ids: created.files.map((f) => f.id) };
  }
  const skip = (ch: string, id: string, value: "user" | null, headers?: Record<string, string>) =>
    api(`/chapters/${ch}/source-files/${id}`, { method: "PATCH", body: { skip: value }, headers });

  it("skipped images stay listed but never reach ingest; undo brings them back", async () => {
    const { ch, ids } = await draftChapter(3, "7");
    const [a, b, c] = ids as [string, string, string];
    expect(await json<{ id: string; skip: string | null }>(await skip(ch, b, "user"), 200)).toMatchObject({
      id: b,
      skip: "user",
    });
    // Hoàn tác rồi bỏ lại: trạng thái cuối mới tính.
    expect((await json<{ skip: string | null }>(await skip(ch, b, null), 200)).skip).toBeNull();
    await json(await skip(ch, b, "user"), 200);

    const detail = await json<{ source_files: { id: string; skip: string | null }[] }>(
      await api(`/chapters/${ch}`),
      200,
    );
    expect(detail.source_files.map((f) => [f.id, f.skip])).toEqual([
      [a, null],
      [b, "user"],
      [c, null],
    ]);

    const commit = await json<{ accepted: number; rejected: unknown[] }>(
      await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }),
      202,
    );
    expect(commit).toMatchObject({ accepted: 2, rejected: [] });
    // Ảnh bỏ qua không bị xoá khi commit (còn để hoàn tác / tải tiếp khớp bộ file).
    expect((await db.select().from(sourceFiles).where(eq(sourceFiles.chapterId, ch))).length).toBe(3);

    // Test khoá chương trước đó để lại job ingest đang chờ → chọn đúng job của chương này.
    const ij = (await claimFor(ch, "chapter.ingest")).find((j) => j.payload.chapter_id === ch) as Claimed;
    const sources = (ij.inputs as { sources: { source_file_id: string }[] }).sources;
    expect(sources.map((s) => s.source_file_id)).toEqual([a, c]);
    expect((await doIngest(token, ij)).status).toBe(200);
    expect((await progress(ch)).pages).toHaveLength(2);

    // Đã có page → bộ ảnh gốc khoá lại.
    expect((await skip(ch, a, "user")).status).toBe(409);
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });

  it("refuses to commit when every image is skipped; rejects credit from the API and other chapters' files", async () => {
    const { ch, ids } = await draftChapter(1, "7.5");
    const other = await draftChapter(1, "7.6");
    expect(
      (await api(`/chapters/${ch}/source-files/${ids[0]}`, { method: "PATCH", body: { skip: "credit" } })).status,
    ).toBe(400);
    // File của chương khác → 404 (không đổi gì).
    expect((await skip(ch, other.ids[0] as string, "user")).status).toBe(404);
    await json(await skip(ch, ids[0] as string, "user"), 200);
    const res = await json<{ error: string }>(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 400);
    expect(res.error).toBe("no_valid_files");
    // Vẫn là nháp: dùng lại ảnh rồi commit được.
    await json(await skip(ch, ids[0] as string, null), 200);
    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });

  it("another tab holding the lock blocks skipping (423)", async () => {
    const { ch, ids } = await draftChapter(1, "7.7");
    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);
    expect((await skip(ch, ids[0] as string, "user", TAB_B)).status).toBe(423);
    await json(await skip(ch, ids[0] as string, "user"), 200);
    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE" })).status).toBe(204);
  });

  it("a non-uuid file id is 404, not a server error", async () => {
    const { ch } = await draftChapter(1, "7.8");
    expect((await skip(ch, "not-a-uuid", "user")).status).toBe(404);
  });

  it("an ingest that failed before creating pages can still skip images and commit again", async () => {
    const { ch, ids } = await draftChapter(2, "7.9");
    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    const ij = (await claimFor(ch, "chapter.ingest")).find((j) => j.payload.chapter_id === ch) as Claimed;
    expect((await failJob(token, ij, "invalid_input")).status).toBe(200);
    expect((await progress(ch)).chapter.status).toBe("partial_failed");

    await json(await skip(ch, ids[1] as string, "user"), 200);
    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    const again = (await claimFor(ch, "chapter.ingest")).find((j) => j.payload.chapter_id === ch) as Claimed;
    expect((again.inputs as { sources: { source_file_id: string }[] }).sources.map((s) => s.source_file_id)).toEqual([
      ids[0],
    ]);
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });
});

describe("reorder source files before step 1", () => {
  async function draftChapter(n: number, number: string) {
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
    return { ch: created.chapter.id, ids: created.files.map((f) => f.id) };
  }
  const reorder = (ch: string, ids: string[], headers?: Record<string, string>) =>
    api(`/chapters/${ch}/source-files/order`, { method: "PUT", body: { ids }, headers });
  const listed = async (ch: string) =>
    (await json<{ source_files: { id: string }[] }>(await api(`/chapters/${ch}`), 200)).source_files.map((f) => f.id);

  it("rewrites ord, keeps skipped images in place, and ingest follows the new order", async () => {
    const { ch, ids } = await draftChapter(3, "8");
    const [a, b, c] = ids as [string, string, string];
    await json(await api(`/chapters/${ch}/source-files/${b}`, { method: "PATCH", body: { skip: "user" } }), 200);
    const res = await json<{ source_files: { id: string; ord: number; skip: string | null }[] }>(
      await reorder(ch, [c, b, a]),
      200,
    );
    expect(res.source_files.map((f) => [f.id, f.ord, f.skip])).toEqual([
      [c, 0, null],
      [b, 1, "user"],
      [a, 2, null],
    ]);
    expect(await listed(ch)).toEqual([c, b, a]);

    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    const ij = (await claimFor(ch, "chapter.ingest")).find((j) => j.payload.chapter_id === ch) as Claimed;
    expect((ij.inputs as { sources: { source_file_id: string }[] }).sources.map((s) => s.source_file_id)).toEqual([
      c,
      a,
    ]);
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });

  it("rejects a missing, extra, duplicate or foreign id with 400 and leaves the order alone", async () => {
    const { ch, ids } = await draftChapter(3, "8.1");
    const other = await draftChapter(1, "8.2");
    const [a, b, c] = ids as [string, string, string];
    const bad = [[a, b], [a, b, c, other.ids[0] as string], [a, a, b], [a, b, other.ids[0] as string], []];
    for (const list of bad) {
      const res = await reorder(ch, list as string[]);
      expect(res.status, JSON.stringify(list)).toBe(400);
    }
    expect((await json<{ error: string }>(await reorder(ch, [a, b]), 400)).error).toBe("source_set_mismatch");
    expect((await api(`/chapters/${ch}/source-files/order`, { method: "PUT", body: { ids: ["x"] } })).status).toBe(400);
    expect(await listed(ch)).toEqual([a, b, c]);
  });

  it("refuses once the chapter is past step 1 (409, like skip) and while another tab holds the lock (423)", async () => {
    const { ch, ids } = await draftChapter(2, "8.3");
    const [a, b] = ids as [string, string];
    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);
    expect((await reorder(ch, [b, a], TAB_B)).status).toBe(423);
    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE" })).status).toBe(204);

    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    const res = await reorder(ch, [b, a]);
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "chapter_not_draft" });
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });
});

describe("hide pages after step 1", () => {
  /** Job loại `type` của đúng chương này (test khác có thể để lại job đang chờ). */
  const claimOwn = async (ch: string, type: string) =>
    (await claimFor(ch, type)).find((j) => j.payload.chapter_id === ch) as Claimed;
  const hide = (pageId: string, skipped: boolean) => api(`/pages/${pageId}`, { method: "PATCH", body: { skipped } });

  it("a hidden page is not translated, not counted, not exported; restoring it brings the chapter back to step 2", async () => {
    const ch = await uploadChapter(3, "8");
    expect((await doIngest(token, await claimOwn(ch, "chapter.ingest"))).status).toBe(200);
    // Claim lặp tới khi đủ prepare của chương này (job sót của test khác chiếm chỗ trong lượt claim).
    const own = new Set((await progress(ch)).pages.map((p) => p.id));
    for (let round = 0; round < 5 && (await progress(ch)).chapter.status !== "prepared"; round++) {
      for (const j of await claimFor(ch, "page.prepare")) {
        if (own.has(j.payload.page_id as string)) expect((await doPrepare(token, j)).status).toBe(200);
      }
    }
    const [p0, p1, p2] = (await progress(ch)).pages.map((p) => p.id) as [string, string, string];

    // Không giữ khoá → 423 (ghi nội dung chương).
    expect((await hide(p1, true)).status).toBe(423);
    await json(await api(`/chapters/${ch}/lock`, { method: "POST" }), 200);
    expect(await json<{ id: string; skipped: boolean }>(await hide(p1, true), 200)).toEqual({ id: p1, skipped: true });

    const afterHide = await json<Progress>(await api(`/chapters/${ch}/progress`), 200);
    expect(afterHide.counts).toEqual({ prepared: 2 });
    expect(afterHide.pages.map((p) => p.skipped)).toEqual([false, true, false]);

    // Bước 2 dịch đúng các trang còn hiện, vẫn ngữ cảnh cuộn cả chương.
    await json(await api(`/chapters/${ch}/translate-prepared`, { method: "POST" }), 202);
    const tj = await claimOwn(ch, "chapter.translate");
    expect(tj.payload.page_ids).toEqual([p0, p2]);
    expect(tj.payload.context).toBe("rolling");
    // Đang dịch → không ẩn / khôi phục được.
    expect((await hide(p0, true)).status).toBe(409);
    expect((await doTranslate(token, tj)).status).toBe(200);
    expect((await progress(ch)).chapter.status).toBe("review");

    // Dịch lại riêng trang ẩn → 409; dịch lại trang 3 → ngữ cảnh là trang 1 (đã dịch), bỏ qua trang 2 đã ẩn.
    const denied = await json<{ error: string }>(
      await api(`/chapters/${ch}/translate`, { method: "POST", body: { page_ids: [p1] } }),
      409,
    );
    expect(denied.error).toBe("page_skipped");
    // Bản dịch riêng cho trang 1 để biết ngữ cảnh lấy từ trang nào (trang 2 chưa dịch → bản dịch rỗng).
    await db
      .update(pageStates)
      .set({ state: aiState(720, 3000, "Trang một") })
      .where(eq(pageStates.pageId, p0));
    await json(await api(`/chapters/${ch}/translate`, { method: "POST", body: { page_ids: [p2] } }), 202);
    const rj = await claimOwn(ch, "chapter.translate");
    const ctx = (rj.inputs as { context_lines: { translation: string }[] }).context_lines;
    expect(ctx.map((l) => l.translation)).toEqual(["Trang một"]);
    expect((await doTranslate(token, rj)).status).toBe(200);

    // Tìm/Thay không thấy trang ẩn: trang 2 (ẩn) có cùng chữ với trang 1 nhưng không khớp.
    await db
      .update(pageStates)
      .set({ state: aiState(720, 3000, "Trang hai") })
      .where(eq(pageStates.pageId, p1));
    const found = await json<{ matches: { page_id: string }[] }>(
      await api(`/chapters/${ch}/find-replace/preview`, { method: "POST", body: { find: "Trang", replace: "Tờ" } }),
      200,
    );
    expect(found.matches.map((m) => m.page_id)).toEqual([p0]);

    // Xuất: input đánh dấu trang ẩn, không vẽ chữ trang đó.
    await json(await api(`/chapters/${ch}/export`, { method: "POST", body: { format: "cbz", layout: "pages" } }), 202);
    const ej = await claimOwn(ch, "chapter.export");
    const ex = (ej.inputs as { pages: { page_id: string; skipped: boolean; translated: boolean }[] }).pages;
    expect(ex.map((p) => [p.page_id, p.skipped, p.translated])).toEqual([
      [p0, false, true],
      [p1, true, false],
      [p2, false, true],
    ]);
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);

    // Không ẩn được trang cuối cùng còn hiện.
    await json(await hide(p0, true), 200);
    expect((await json<{ error: string }>(await hide(p2, true), 409)).error).toBe("last_page");
    await json(await hide(p0, false), 200);

    // Khôi phục trang chưa dịch → chương về "chờ dịch" (bước 2 dịch nốt trang đó).
    await json(await hide(p1, false), 200);
    expect((await progress(ch)).chapter.status).toBe("prepared");

    // Trang 2 dịch lỗi (các trang khác xong) → chương lỗi một phần; ẩn trang lỗi duy nhất → chương chờ duyệt.
    await db.update(pages).set({ status: "failed" }).where(eq(pages.id, p1));
    await json(await hide(p0, true), 200);
    await json(await hide(p0, false), 200);
    expect((await progress(ch)).chapter.status).toBe("partial_failed");
    await json(await hide(p1, true), 200);
    expect((await progress(ch)).chapter.status).toBe("review");
    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE" })).status).toBe(204);
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

describe("ignored text (watermark) per series", () => {
  it("validates the list; changing it bumps glossary_rev, never settings_rev", async () => {
    const s = await json<{ id: string; settings_rev: number; glossary_rev: number; ignore_text: string[] }>(
      await api("/series", { method: "POST", body: { title: "Ignore rev" } }),
      201,
    );
    expect(s.ignore_text).toEqual([]);
    const patch = (ignore_text: unknown) => api(`/series/${s.id}`, { method: "PATCH", body: { ignore_text } });
    expect((await patch(["ab"])).status).toBe(400);
    // Ngưỡng tính trên dạng đã chuẩn hoá: "http://a" còn "a", 1 chữ NFD vẫn là 1 ký tự.
    expect((await patch(["http://a"])).status).toBe(400);
    expect((await patch(["ắ".normalize("NFD")])).status).toBe(400);
    expect((await patch(["x".repeat(101)])).status).toBe(400);
    // RE2 không có tham chiếu ngược / lookaround.
    expect((await patch(["/(abc)\\1/"])).status).toBe(400);
    expect((await patch(["/foo(?=bar)/"])).status).toBe(400);
    expect((await patch(Array.from({ length: 51 }, (_, i) => `mục ${i}`))).status).toBe(400);
    const t1 = await json<typeof s>(await patch([" discord.gg ", "DISCORD.GG", "Asura Scans"]), 200);
    expect(t1).toMatchObject({
      ignore_text: ["discord.gg", "Asura Scans"],
      glossary_rev: s.glossary_rev + 1,
      settings_rev: s.settings_rev,
    });
    // Lưu lại y nguyên → không tăng.
    expect((await json<typeof s>(await patch(["discord.gg", "Asura Scans"]), 200)).glossary_rev).toBe(t1.glossary_rev);
  });

  it("a matching OCR line is sent as empty, kept out of neighbour context; removing the entry translates it again", async () => {
    const ch = await uploadChapter(3, "8");
    await ingestAndPrepare(ch);
    // Mỗi page thêm 1 dòng watermark cạnh thoại.
    const rows = await db.select().from(pages).where(eq(pages.chapterId, ch));
    for (const p of rows) {
      const ocr = p.ocrResult as NonNullable<typeof p.ocrResult>;
      await db
        .update(pages)
        .set({
          ocrResult: {
            ...ocr,
            items: [
              ...ocr.items,
              { ...(ocr.items[0] as (typeof ocr.items)[number]), id: "wm", source: "Read at DISCORD.GG/abc" },
            ],
          },
        })
        .where(eq(pages.id, p.id));
    }
    const ignore = async (list: string[]) =>
      json(await api(`/series/${A.seriesId}`, { method: "PATCH", body: { ignore_text: list } }), 200);
    await ignore(["discord.gg"]);
    type Inputs = {
      pages: { ocr_result: { items: { id: string; empty: boolean }[] } }[];
      context_lines: { source: string }[];
    };
    const emptyOf = (i: Inputs) => i.pages.flatMap((p) => p.ocr_result.items.map((it) => [it.id, it.empty]));

    const [tj] = await claimFor(ch, "chapter.translate", 1);
    expect(emptyOf(tj?.inputs as Inputs)).toEqual([
      ["t0", false],
      ["wm", true],
      ["t0", false],
      ["wm", true],
      ["t0", false],
      ["wm", true],
    ]);
    expect((await doTranslate(token, tj as Claimed)).status).toBe(200);
    // DB không bị sửa: chỉ inputs gửi worker.
    const [stored] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, rows[0]?.id as string));
    expect(stored?.ocrResult?.items.find((it) => it.id === "wm")?.empty).toBe(false);

    const mid = (await progress(ch)).pages[1]?.id as string;
    await json(await api(`/chapters/${ch}/translate`, { method: "POST", body: { page_ids: [mid] } }), 202);
    const [nb] = await claimFor(ch, "chapter.translate", 1);
    const ctx = ((nb as Claimed).inputs as Inputs).context_lines.map((l) => l.source);
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx.some((l) => l.includes("DISCORD"))).toBe(false);
    expect((await doTranslate(token, nb as Claimed)).status).toBe(200);

    // Bỏ mục → lần dịch sau gửi vùng đó bình thường.
    await ignore([]);
    await json(await api(`/chapters/${ch}/translate`, { method: "POST", body: { page_ids: [mid] } }), 202);
    const [again] = await claimFor(ch, "chapter.translate", 1);
    expect(emptyOf(again?.inputs as Inputs)).toEqual([
      ["t0", false],
      ["wm", false],
    ]);
    expect((await doTranslate(token, again as Claimed)).status).toBe(200);
  });
});

describe("recent chapters", () => {
  type Recent = {
    chapters: {
      id: string;
      number: string;
      series_title: string;
      exported: boolean;
      page_counts: { total: number };
    }[];
  };

  it("orders by updated_at (chapters open for editing first), honours limit and open, carries series_title", async () => {
    const R = await seedUser("recent");
    const sdb = scoped(db, R.userId);
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
    const get = async (qs: string) => json<Recent>(await call(`/api/recent-chapters${qs}`, { cookie: R.cookie }), 200);

    const all = await get("");
    expect(all.chapters.map((c) => c.id)).toEqual([fresh.id, mid.id, old.id, R.chapterId]);
    expect(all.chapters[0]).toMatchObject({ series_title: "Series recent" });
    expect(all.chapters[0]).not.toHaveProperty("lock_holder_is_me");
    expect(all.chapters[0]?.page_counts).toEqual({ total: 0, ready: 0, failed: 0, busy: 0 });
    expect((await get("?limit=2")).chapters.map((c) => c.id)).toEqual([fresh.id, mid.id]);
    expect((await call(`/api/recent-chapters?limit=0`, { cookie: R.cookie })).status).toBe(400);

    // Chương đang mở sửa (khoá còn hạn) → đứng đầu dù updated_at cũ (lock bump updated_at nên ép lại cho chắc thứ tự).
    await json(await call(`/api/chapters/${old.id}/lock`, { method: "POST", cookie: R.cookie }), 200);
    await db
      .update(chapters)
      .set({ updatedAt: at(30) })
      .where(eq(chapters.id, old.id));
    const locked = await get("");
    expect(locked.chapters[0]?.id).toBe(old.id);

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
    const R = await seedUser("reexport");
    const sdb = scoped(db, R.userId);
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
        originalKey: `u/${R.userId}/ch/${ch.id}/ingest/1/0.png`,
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
    const open = await json<Recent>(await call(`/api/recent-chapters?open=1`, { cookie: R.cookie }), 200);
    const ids = open.chapters.map((c) => c.id);
    expect(ids).not.toContain(clean);
    expect(open.chapters.find((c) => c.id === edited)).toMatchObject({ exported: false, reexport: true });
    expect(open.chapters.find((c) => c.id === retranslated)).toMatchObject({ exported: false, reexport: true });

    // Xuất lại → hết cần làm.
    await job(edited, "chapter.export", 0);
    const again = await json<Recent>(await call(`/api/recent-chapters?open=1`, { cookie: R.cookie }), 200);
    expect(again.chapters.map((c) => c.id)).not.toContain(edited);
    const d = await json<{ chapters: { id: string; exported: boolean; reexport: boolean }[] }>(
      await call(`/api/series/${R.seriesId}`, { cookie: R.cookie }),
      200,
    );
    expect(d.chapters.find((c) => c.id === clean)).toMatchObject({ exported: true, reexport: false });
    expect(d.chapters.find((c) => c.id === retranslated)).toMatchObject({ exported: false, reexport: true });
  });

  it("hiding or restoring a page after the last export needs re-export; a no-op PATCH does not", async () => {
    const R = await seedUser("reexport-skip");
    const sdb = scoped(db, R.userId);
    const ch = await sdb.insert(chapters, { seriesId: R.seriesId, number: "1", status: "review" });
    const ids: [string, string] = [pageId(ch.id, 1, 0), pageId(ch.id, 1, 1)];
    for (const [ord, id] of ids.entries()) {
      await sdb.insert(pages, {
        id,
        chapterId: ch.id,
        ord,
        width: 10,
        height: 10,
        originalKey: `u/${R.userId}/ch/${ch.id}/ingest/1/${ord}.png`,
        originalSha256: "ab".repeat(32),
        status: "ready",
      });
      await sdb.insert(pageStates, {
        pageId: id,
        state: emptyPageState(10, 10),
        updatedAt: new Date(Date.now() - 30 * 60_000),
      });
    }
    const exportAt = (min: number) =>
      sdb.insert(jobs, {
        type: "chapter.export",
        status: "succeeded",
        payload: { type: "chapter.export" } as never,
        inputRev: "x",
        idempotencyKey: uniq("export"),
        chapterId: ch.id,
        createdAt: new Date(Date.now() - min * 60_000),
      });
    const hide = (pageId: string, skipped: boolean) =>
      call(`/api/pages/${pageId}`, { method: "PATCH", cookie: R.cookie, body: { skipped } });
    const reexport = async () =>
      (
        await json<{ chapters: { id: string; reexport: boolean }[] }>(
          await call(`/api/series/${R.seriesId}`, { cookie: R.cookie }),
          200,
        )
      ).chapters.find((c) => c.id === ch.id)?.reexport;
    await json(await call(`/api/chapters/${ch.id}/lock`, { method: "POST", cookie: R.cookie }), 200);

    await exportAt(20);
    expect(await reexport()).toBe(false);
    await json(await hide(ids[0], true), 200);
    expect(await reexport()).toBe(true);
    await json(await hide(ids[0], false), 200);
    expect(await reexport()).toBe(true);

    // Xuất lại sau lần đổi cuối → hết cờ; PATCH cùng giá trị không bật lại.
    await exportAt(-1);
    expect(await reexport()).toBe(false);
    await json(await hide(ids[0], false), 200);
    expect(await reexport()).toBe(false);
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
  it("renumbers, moves to another series of the same user, rejects a taken number and foreign series", async () => {
    const R = await seedUser("patch");
    const O = await seedUser("patch-other");
    const sdb = scoped(db, R.userId);
    const other = await sdb.insert(series, { title: "Series khác" });
    await sdb.insert(chapters, { seriesId: R.seriesId, number: "2" });
    await sdb.insert(chapters, { seriesId: other.id, number: "7" });
    const patch = (body: unknown, id = R.chapterId) =>
      call(`/api/chapters/${id}`, { method: "PATCH", cookie: R.cookie, body });
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
      await call(`/api/chapters/${R.chapterId}`, { cookie: R.cookie }),
      200,
    );
    expect(detail.series.id).toBe(other.id);

    // Series của người dùng khác → 404, chương không đổi.
    expect((await patch({ series_id: O.seriesId })).status).toBe(404);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ number: "abc" })).status).toBe(400);
    const [row] = await sdb.select(chapters, eq(chapters.id, R.chapterId));
    expect(row).toMatchObject({ seriesId: other.id, number: "8" });
  });
});

describe("delete chapter / series", () => {
  it("removes a processed chapter with its jobs, pages and stored files; refuses while another tab edits", async () => {
    const ch = await uploadChapter(2, "601");
    await ingestAndPrepare(ch);
    const [src] = await db.select().from(sourceFiles).where(eq(sourceFiles.chapterId, ch));
    const pageIds = (await db.select().from(pages).where(eq(pages.chapterId, ch))).map((p) => p.id);
    expect(pageIds).toHaveLength(2);
    expect(await head(src?.storageKey ?? "")).not.toBeNull();

    await json(await api(`/chapters/${ch}/lock`, { method: "POST", headers: TAB_B }), 200);
    const locked = await json<{ error: string }>(await api(`/chapters/${ch}`, { method: "DELETE" }), 423);
    expect(locked.error).toBe("chapter_locked");
    expect((await api(`/chapters/${ch}/lock`, { method: "DELETE", headers: TAB_B })).status).toBe(204);

    expect((await api(`/chapters/${ch}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/chapters/${ch}`)).status).toBe(404);
    expect(await db.select().from(jobs).where(eq(jobs.chapterId, ch))).toEqual([]);
    expect(await db.select().from(pages).where(eq(pages.chapterId, ch))).toEqual([]);
    expect(await head(src?.storageKey ?? "")).toBeNull();
    // Không còn object nào dưới prefix của chương / page (deletePrefix đếm lại = 0).
    for (const p of [`u/${A.userId}/ch/${ch}/`, ...pageIds.map((id) => `u/${A.userId}/pg/${id}/`)]) {
      expect(await deletePrefix(p)).toBe(0);
    }
    expect((await api(`/chapters/${ch}`, { method: "DELETE" })).status).toBe(404);
  });

  it("deletes a series with its chapters and glossary (own data only)", async () => {
    const O = await seedUser("del-other");
    const sdb = scoped(db, A.userId);
    const s = await sdb.insert(series, { title: "Series xoá" });
    const ch = await sdb.insert(chapters, { seriesId: s.id, number: "1" });
    await sdb.insert(glossaryEntries, { seriesId: s.id, sourceTerm: "검", targetTerm: "kiếm" });

    expect((await call(`/api/series/${s.id}`, { method: "DELETE", cookie: O.cookie })).status).toBe(404);
    expect((await call(`/api/chapters/${ch.id}`, { method: "DELETE", cookie: O.cookie })).status).toBe(404);

    expect((await api(`/series/${s.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/series/${s.id}`)).status).toBe(404);
    expect(await db.select().from(chapters).where(eq(chapters.seriesId, s.id))).toEqual([]);
    expect(await db.select().from(glossaryEntries).where(eq(glossaryEntries.seriesId, s.id))).toEqual([]);
  });
});
