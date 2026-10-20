/** Xuất chương: enqueue, inputs lúc claim, output export có tag lifecycle, complete kiểm key/size, tải qua 302 ≤ 5'. */
import { chapters, jobs, pageStates, pages, scoped } from "@mtl/db";
import { ExportInputs, pageId, storageKeys } from "@mtl/shared";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { attachmentDisposition } from "../src/routes/export.ts";
import { objectTags } from "../src/storage.ts";
import { call, db, seedWorkspace } from "./helpers.ts";
import { aiState, type Claimed, claimJobs, complete, SHA, wcall, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
type View = { id: string; status: string; bytes: number | null; download_url: string | null; expires_at: string };
let A: Seed;
let B: Seed;
let token: string;

const W = 400;
const H = 900;
const SRC = ["0190a000-0000-7000-8000-000000000001", "0190a000-0000-7000-8000-000000000002"];

/** 2 page: page 0 đã dịch (clean rev 2), page 1 chưa qua giai đoạn 2. */
async function seedPages(s: Seed) {
  const sdb = scoped(db, s.workspaceId);
  for (const ord of [0, 1]) {
    const id = pageId(s.chapterId, 1, ord);
    await sdb.insert(pages, {
      id,
      chapterId: s.chapterId,
      ord,
      width: W,
      height: H,
      originalKey: storageKeys.ingestPage(s.workspaceId, s.chapterId, 1, ord),
      originalSha256: SHA,
      cleanRev: ord === 0 ? 2 : null,
      status: ord === 0 ? "ready" : "failed",
      sourceMap: [{ source_file_id: SRC[ord], src_y: 0, page_y: 0, h: H }],
    });
    await sdb.insert(pageStates, { pageId: id, state: aiState(W, H, `Trang ${ord}`) });
  }
}

const api = (s: Seed, path: string, init: { method?: string; body?: unknown } = {}) =>
  call(`/api/w/${s.workspaceId}${path}`, { cookie: s.cookie, ...init });

async function startExport(s: Seed, body: Record<string, unknown> = { format: "cbz", layout: "pages" }) {
  const res = await api(s, `/chapters/${s.chapterId}/export`, { method: "POST", body });
  expect(res.status, await res.clone().text()).toBe(202);
  return (await res.json()) as { job: View; created: boolean };
}

async function claimExport(): Promise<Claimed> {
  const [j] = await claimJobs(token, { caps: ["chapter.export"] });
  if (!j) throw new Error("no export job claimed");
  return j;
}

async function putExport(j: Claimed, body: Uint8Array, headers?: Record<string, string>) {
  const out = j.outputs.export as Claimed["outputs"][string] & { headers: Record<string, string> };
  return fetch(out.put, { method: "PUT", body, headers: headers ?? out.headers });
}

beforeAll(async () => {
  [A, B] = await Promise.all([seedWorkspace("exp-a"), seedWorkspace("exp-b")]);
  await seedPages(A);
  ({ token } = await workerToken(A.workspaceId, "export-worker"));
});

describe("POST /chapters/:id/export", () => {
  it("validates body and rejects chapters without pages", async () => {
    expect((await api(A, `/chapters/${A.chapterId}/export`, { method: "POST", body: { format: "pdf" } })).status).toBe(
      400,
    );
    const res = await api(B, `/chapters/${B.chapterId}/export`, {
      method: "POST",
      body: { format: "png_zip", layout: "pages" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("no_pages");
  });

  it("refuses while the chapter is still ingesting/processing (409 chapter_busy)", async () => {
    await db.update(chapters).set({ status: "processing" }).where(eq(chapters.id, A.chapterId));
    const res = await api(A, `/chapters/${A.chapterId}/export`, {
      method: "POST",
      body: { format: "cbz", layout: "pages" },
    });
    await db.update(chapters).set({ status: "review" }).where(eq(chapters.id, A.chapterId));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("chapter_busy");
  });

  it("is idempotent while the job is active (same options + unchanged pages)", async () => {
    const a = await startExport(A, { format: "png_zip", layout: "original_slices", quality: 80 });
    const b = await startExport(A, { format: "png_zip", layout: "original_slices", quality: 80 });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    await api(A, `/jobs/${a.job.id}/cancel`, { method: "POST" });
  });
});

describe("export job lifecycle", () => {
  let j: Claimed;
  let view: View;

  it("claim gives state snapshot, background per page and a tagged export output", async () => {
    view = (await startExport(A, { format: "cbz", layout: "pages", include_untranslated: true })).job;
    j = await claimExport();
    expect(j.id).toBe(view.id);
    const inputs = ExportInputs.parse(j.inputs);
    expect(inputs.pages.map((p) => [p.ord, p.translated])).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(inputs.pages[0]?.background).toContain(storageKeys.clean(A.workspaceId, pageId(A.chapterId, 1, 0), 2));
    expect(inputs.pages[0]?.state?.regions[0]?.translation).toBe("Trang 0");
    expect(inputs.pages[1]?.background).toContain("/ingest/1/1.png");
    expect(inputs.pages[1]?.state).toBeNull();
    expect(inputs.pages[0]?.source_map[0]?.source_file_id).toBe(SRC[0]);
    const out = j.outputs.export as Claimed["outputs"][string] & { headers: Record<string, string> };
    expect(out.key).toBe(storageKeys.export(A.workspaceId, A.chapterId, j.id, "cbz"));
    expect(out.headers).toEqual({
      "content-type": "application/vnd.comicbook+zip",
      "x-amz-tagging": "mtl-kind=export",
    });
  });

  it("PUT without the signed tagging header is rejected; with it the object carries the lifecycle tag", async () => {
    const bad = await putExport(j, new Uint8Array([1, 2, 3]), { "content-type": "application/vnd.comicbook+zip" });
    expect(bad.ok).toBe(false); // thiếu header đã ký → MinIO từ chối (400/403)
    const ok = await putExport(j, new Uint8Array(1234));
    expect(ok.status, await ok.text()).toBe(200);
    expect(await objectTags(j.outputs.export?.key ?? "")).toEqual({ "mtl-kind": "export" });
  });

  it("download before completion → 409", async () => {
    expect((await api(A, `/exports/${j.id}/download`)).status).toBe(409);
  });

  it("complete checks the key and records the real object size", async () => {
    const wrong = await complete(token, j, { type: "chapter.export", key: `ws/${A.workspaceId}/x.cbz`, bytes: 1 });
    expect(wrong.status).toBe(400);
    const res = await complete(token, j, { type: "chapter.export", key: j.outputs.export?.key ?? "", bytes: 1 });
    expect(res.status, await res.clone().text()).toBe(200);
    const got = (await (await api(A, `/exports/${j.id}`)).json()) as View;
    expect(got.status).toBe("succeeded");
    expect(got.bytes).toBe(1234);
    expect(got.download_url).toBe(`/api/w/${A.workspaceId}/exports/${j.id}/download`);
    const list = (await (await api(A, `/chapters/${A.chapterId}/exports`)).json()) as { exports: View[] };
    expect(list.exports[0]?.id).toBe(j.id);
  });

  it("download → 302 to a presigned GET valid ≤ 5 minutes, as attachment", async () => {
    const res = await api(A, `/exports/${j.id}/download`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(Number(loc.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(300);
    expect(loc.searchParams.get("response-content-disposition")).toMatch(
      /^attachment; filename="Series exp-a-ch1\.cbz"/,
    );
    const file = await fetch(loc);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment/);
    expect((await file.arrayBuffer()).byteLength).toBe(1234);
  });

  it("another workspace's job id → 404; non-export job → 404", async () => {
    expect((await api(B, `/exports/${j.id}/download`)).status).toBe(404);
    expect((await api(B, `/exports/${j.id}`)).status).toBe(404);
    const [other] = await scoped(db, A.workspaceId).select(jobs, eq(jobs.type, "page.prepare"));
    if (other) expect((await api(A, `/exports/${other.id}/download`)).status).toBe(404);
  });

  it("older than 7 days → 410 and no download link", async () => {
    await db.update(jobs).set({ updatedAt: sql`now() - interval '8 days'` }).where(eq(jobs.id, j.id));
    expect((await api(A, `/exports/${j.id}/download`)).status).toBe(410);
    expect(((await (await api(A, `/exports/${j.id}`)).json()) as View).download_url).toBeNull();
  });
});

describe("worker protocol", () => {
  it("presign-outputs accepts `export` only for export jobs", async () => {
    const v = (await startExport(A, { format: "png_zip", layout: "pages", quality: 50 })).job;
    const j = await claimExport();
    expect(j.id).toBe(v.id);
    const res = await wcall(token, `/jobs/${j.id}/presign-outputs`, {
      lease_token: j.lease_token,
      attempt: j.attempt,
      names: ["export"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outputs: { export: { key: string; headers: Record<string, string> } } };
    expect(body.outputs.export.key).toMatch(/\.zip$/);
    expect(body.outputs.export.headers["content-type"]).toBe("application/zip");
    const bad = await wcall(token, `/jobs/${j.id}/presign-outputs`, {
      lease_token: j.lease_token,
      attempt: j.attempt,
      names: ["clean"],
    });
    expect(bad.status).toBe(400);
  });
});

describe("attachmentDisposition", () => {
  it("keeps an ASCII fallback and the UTF-8 name, strips path/quote characters", () => {
    expect(attachmentDisposition('Kiếm "Đạo"/1-ch2.cbz')).toBe(
      `attachment; filename="Kiem _Dao_1-ch2.cbz"; filename*=UTF-8''${encodeURIComponent("Kiếm _Đạo_1-ch2.cbz")}`,
    );
  });
});
