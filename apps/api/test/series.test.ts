/** Cài đặt series: ngôn ngữ nguồn/đích, page_format (mặc định theo nguồn, commit dùng nó), payload job mang ngôn ngữ. */
import { randomUUID } from "node:crypto";
import { chapters, jobs, pages, scoped, series } from "@mtl/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enqueueIngest, enqueueOcrRegion, enqueuePrepare, inJobTx, translateSettings } from "../src/jobs/enqueue.ts";
import { call, db, seedWorkspace } from "./helpers.ts";
import { addSources } from "./worker-helpers.ts";

type SeriesView = { id: string; source_lang: string; target_lang: string; page_format: string; settings_rev: number };

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function setup(label: string) {
  const A = await seedWorkspace(label);
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    call(`/api/w/${A.workspaceId}${path}`, { cookie: A.cookie, ...init });
  const create = async (body: Record<string, unknown>) =>
    json<SeriesView>(await api("/series", { method: "POST", body: { title: "T", ...body } }), 201);
  return { A, api, create, sdb: scoped(db, A.workspaceId) };
}

describe("series languages + page_format", () => {
  it("page_format mặc định theo nguồn; gửi tường minh thì thắng", async () => {
    const { create } = await setup("ser-default");
    expect((await create({})).page_format).toBe("strip");
    expect((await create({ source_lang: "ja" })).page_format).toBe("pages");
    expect((await create({ source_lang: "zh" })).page_format).toBe("strip");
    expect((await create({ source_lang: "ko" })).page_format).toBe("strip");
    expect((await create({ source_lang: "ja", page_format: "strip" })).page_format).toBe("strip");
  });

  it("mọi nguồn × đích hỗ trợ đều lưu được; mã lạ → 400", async () => {
    const { api, create } = await setup("ser-langs");
    const s = await create({});
    for (const source_lang of ["ko", "ja", "zh", "en"]) {
      for (const target_lang of ["vi", "en", "id", "es", "pt", "fr"]) {
        const v = await json<SeriesView>(
          await api(`/series/${s.id}`, { method: "PATCH", body: { source_lang, target_lang } }),
          200,
        );
        expect([v.source_lang, v.target_lang]).toEqual([source_lang, target_lang]);
      }
    }
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: { target_lang: "de" } })).status).toBe(400);
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: { source_lang: "th" } })).status).toBe(400);
    expect((await api(`/series/${s.id}`, { method: "PATCH", body: { page_format: "scroll" } })).status).toBe(400);
  });

  it("đổi page_format không tăng settings_rev (chỉ áp cho lần commit sau); đổi nguồn không tự đổi page_format", async () => {
    const { api, create } = await setup("ser-rev");
    const s = await create({});
    const patch = async (body: unknown) =>
      json<SeriesView>(await api(`/series/${s.id}`, { method: "PATCH", body }), 200);
    const a = await patch({ page_format: "pages" });
    expect([a.page_format, a.settings_rev]).toEqual(["pages", s.settings_rev]);
    const b = await patch({ source_lang: "zh" });
    expect(b.page_format).toBe("pages");
    expect(b.settings_rev).toBe(s.settings_rev + 1);
  });

  it("commit không gửi mode → ingest theo page_format của series; mode tường minh vẫn override", async () => {
    const { A, sdb } = await setup("ser-ingest");
    await sdb.update(series, eq(series.id, A.seriesId), { pageFormat: "pages" });
    await addSources(A.workspaceId, A.chapterId, 2);
    const { job } = await inJobTx((tx) => enqueueIngest(tx, A.workspaceId, A.chapterId));
    expect(job.payload).toMatchObject({ type: "chapter.ingest", mode: "pages" });
    expect((await sdb.byId(chapters, A.chapterId)).ingestMode).toBe("pages");

    const ch2 = await sdb.insert(chapters, { seriesId: A.seriesId, number: "2" });
    await addSources(A.workspaceId, ch2.id, 1);
    const { job: j2 } = await inJobTx((tx) => enqueueIngest(tx, A.workspaceId, ch2.id, "strip"));
    expect(j2.payload).toMatchObject({ mode: "strip" });
  });

  it("payload prepare/ocr_region/translate mang ngôn ngữ; ja + pages → đọc phải→trái", async () => {
    const { A, sdb } = await setup("ser-payload");
    const page = await sdb.insert(pages, {
      id: randomUUID(),
      chapterId: A.chapterId,
      ord: 0,
      width: 800,
      height: 1200,
      originalKey: `ws/${A.workspaceId}/x.png`,
      originalSha256: "ab".repeat(32),
    });
    // Thứ tự đọc theo mode chương đã ingest (chapters.ingest_mode), không theo page_format hiện tại của series.
    const prepareOf = async (sourceLang: string, ingestMode: "strip" | "pages", pageFormat = ingestMode) => {
      const [s] = await sdb.update(series, eq(series.id, A.seriesId), { sourceLang, pageFormat });
      const [ch] = await sdb.update(chapters, eq(chapters.id, A.chapterId), { ingestMode });
      await sdb.delete(jobs, eq(jobs.pageId, page.id));
      const { job } = await inJobTx((tx) =>
        enqueuePrepare(tx, page, s as typeof series.$inferSelect, ch as typeof chapters.$inferSelect),
      );
      return job.payload;
    };
    expect(await prepareOf("ja", "pages")).toMatchObject({ source_lang: "ja", reading_order: "rtl" });
    expect(await prepareOf("ja", "strip")).toMatchObject({ reading_order: "ltr" });
    expect(await prepareOf("ko", "pages")).toMatchObject({ source_lang: "ko", reading_order: "ltr" });
    // Series vừa đổi sang "Từng trang" nhưng chương đã ingest dạng strip → vẫn ltr.
    expect(await prepareOf("ja", "strip", "pages")).toMatchObject({ reading_order: "ltr" });

    const [s] = await sdb.update(series, eq(series.id, A.seriesId), { sourceLang: "ja", targetLang: "en" });
    const { job } = await inJobTx((tx) =>
      enqueueOcrRegion(tx, A.workspaceId, { type: "page.ocr_region", page_id: page.id, bbox: [0, 0, 10, 10] }),
    );
    expect(job.payload).toMatchObject({ source_lang: "ja", target_lang: "en" });

    const settings = await inJobTx((tx) => translateSettings(tx, s as typeof series.$inferSelect));
    expect(settings).toMatchObject({ source_lang: "ja", target_lang: "en" });
    expect(settings.honorific_policy).toContain("-san");
    expect(settings.honorific_policy).toContain("tiếng Anh");
    // Chưa chọn font dẫn truyện → giống font thoại.
    expect(settings.narration_font).toBe(settings.font);

    const [withFonts] = await sdb.update(series, eq(series.id, A.seriesId), {
      defaultFonts: { dialogue: "Bangers-Regular", narration: "BeVietnamPro-Regular" },
    });
    const fonts = await inJobTx((tx) => translateSettings(tx, withFonts as typeof series.$inferSelect));
    expect(fonts).toMatchObject({ font: "Bangers-Regular", narration_font: "BeVietnamPro-Regular" });
  });
});
