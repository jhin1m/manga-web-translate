/** AI hiệu đính: enqueue (chương đã dịch), inputs lúc claim, nhận gợi ý (lọc lại phía server), bỏ gợi ý. */
import { randomUUID } from "node:crypto";
import { chapters, jobs, pageStates, pages, scoped } from "@mtl/db";
import type { JobResult } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { call, db, seedWorkspace } from "./helpers.ts";
import { aiState, type Claimed, claimJobs, complete, usage, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;
let token: string;
const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
  call(`/api/w/${A.workspaceId}${path}`, { cookie: A.cookie, ...init });

async function readyPage(ord: number, text: string, skipped = false) {
  const sdb = scoped(db, A.workspaceId);
  const p = await sdb.insert(pages, {
    id: randomUUID(),
    chapterId: A.chapterId,
    ord,
    width: 200,
    height: 300,
    originalKey: `ws/${A.workspaceId}/ch/${A.chapterId}/ingest/1/${ord}.png`,
    originalSha256: "ef".repeat(32),
    status: "ready",
    skipped,
  });
  await sdb.insert(pageStates, { pageId: p.id, state: aiState(200, 300, text) });
  return p;
}

beforeAll(async () => {
  A = await seedWorkspace("proofread");
  token = (await workerToken(A.workspaceId, "proofread-test")).token;
});

describe("chapter.proofread", () => {
  it("chương chưa dịch → 409; đã dịch → job với trang ready (bỏ trang ẩn), inputs có bản dịch + ảnh gốc", async () => {
    const sdb = scoped(db, A.workspaceId);
    await sdb.update(chapters, eq(chapters.id, A.chapterId), { status: "processing" });
    expect((await api(`/chapters/${A.chapterId}/proofread`, { method: "POST" })).status).toBe(409);

    const p0 = await readyPage(0, "Xin chao");
    const p1 = await readyPage(1, "Tạm biệt");
    await readyPage(2, "Ẩn", true);
    await sdb.update(chapters, eq(chapters.id, A.chapterId), { status: "review" });
    const res = await api(`/chapters/${A.chapterId}/proofread`, { method: "POST" });
    expect(res.status, await res.clone().text()).toBe(202);
    const { job } = (await res.json()) as { job: { id: string } };
    const again = (await (await api(`/chapters/${A.chapterId}/proofread`, { method: "POST" })).json()) as {
      created: boolean;
    };
    expect(again.created).toBe(false);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.payload).toMatchObject({ type: "chapter.proofread", page_ids: [p0.id, p1.id], model_tier: "standard" });

    const [claimed] = await claimJobs(token, { caps: ["chapter.proofread"] });
    expect(claimed?.id).toBe(job.id);
    const inputs = (claimed as Claimed).inputs as {
      pages: { page_id: string; image: string; regions: { id: string; translation: string }[] }[];
    };
    expect(inputs.pages.map((p) => p.page_id)).toEqual([p0.id, p1.id]);
    expect(inputs.pages[0]?.regions).toEqual([
      { id: "t0", kind: "text_bubble", source: "안녕하세요", translation: "Xin chao" },
    ]);
    expect(inputs.pages[0]?.image).toMatch(/^https?:\/\//);

    const result: JobResult = {
      type: "chapter.proofread",
      suggestions: [
        { page_id: p0.id, region_id: "t0", old: "Xin chao", suggestion: "Xin chào", reason: "thiếu dấu" },
        { page_id: p0.id, region_id: "t0", old: "Xin chao", suggestion: "Chào", reason: "trùng vùng" },
        { page_id: p1.id, region_id: "t0", old: "Tạm biệt", suggestion: " Tạm  biệt ", reason: "chỉ khác dấu cách" },
        { page_id: p1.id, region_id: "nope", old: "", suggestion: "X", reason: "vùng lạ" },
      ],
    };
    const done = await complete(token, claimed as Claimed, result, usage(1));
    expect(done.status, await done.clone().text()).toBe(200);

    const view = (await (await api(`/chapters/${A.chapterId}/proofread`)).json()) as {
      job: { status: string };
      suggestions: { id: string; page_id: string; old: string; suggestion: string; reason: string }[];
    };
    expect(view.job.status).toBe("succeeded");
    expect(view.suggestions).toHaveLength(1);
    expect(view.suggestions[0]).toMatchObject({ page_id: p0.id, old: "Xin chao", suggestion: "Xin chào" });

    const id = view.suggestions[0]?.id ?? "";
    const dis = await api(`/proofread-suggestions/${id}`, { method: "PATCH", body: { dismissed: true } });
    expect(dis.status).toBe(200);
    const after = (await (await api(`/chapters/${A.chapterId}/proofread`)).json()) as { suggestions: unknown[] };
    expect(after.suggestions).toHaveLength(0);
    // page_state không bị đụng (gợi ý không tự ghi đè).
    const [st] = await db.select().from(pageStates).where(eq(pageStates.pageId, p0.id));
    expect(st?.state?.regions[0]?.translation).toBe("Xin chao");
  });
});
