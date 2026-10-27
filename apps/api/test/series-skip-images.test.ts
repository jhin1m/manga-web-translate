/**
 * Ảnh credit series đã học: học từ ảnh gốc / trang, chương mới có ảnh khớp bị bỏ qua sẵn ('credit'), xem, xoá, dọn
 * khi xoá series.
 */
import { pages, seriesSkipImages, sourceFiles } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deletePrefix, head } from "../src/storage.ts";
import { call, db, seedUser } from "./helpers.ts";
import { type Claimed, claimJobs, doIngest, makeRunnable, PNG_1PX, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Upload = { id: string; url: string; fields: Record<string, string> };
type Fp = { dhash?: string; width?: number; height?: number };
type SkipImage = { id: string; width: number; height: number; url: string };

let A: Seed;
let token: string;

beforeAll(async () => {
  A = await seedUser("skipimg");
  token = (await workerToken("mac", "skip-images-test")).token;
});

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  call(`/api${path}`, { cookie: A.cookie, ...init });

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function postFile(u: Upload) {
  const form = new FormData();
  for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
  form.append("file", new Blob([PNG_1PX]));
  expect((await fetch(u.url, { method: "POST", body: form })).status).toBe(204);
}

async function newSeries(title: string) {
  return (await json<{ id: string }>(await api("/series", { method: "POST", body: { title } }), 201)).id;
}

/** Chương nháp, mỗi ảnh kèm dấu nhận dạng `fps[i]`, đã upload. */
async function draft(seriesId: string, number: string, fps: Fp[]) {
  const files = fps.map((fp, i) => ({ name: `${i + 1}.png`, content_type: "image/png", bytes: PNG_1PX.length, ...fp }));
  const created = await json<{ chapter: { id: string }; files: Upload[] }>(
    await api("/chapters", { method: "POST", body: { series_id: seriesId, number, files } }),
    201,
  );
  await Promise.all(created.files.map(postFile));
  const detail = await json<{ source_files: { id: string; skip: string | null }[] }>(
    await api(`/chapters/${created.chapter.id}`),
    200,
  );
  return { ch: created.chapter.id, files: detail.source_files };
}

const learn = (seriesId: string, body: Record<string, string>) =>
  api(`/series/${seriesId}/skip-images`, { method: "POST", body });
const list = async (seriesId: string) =>
  (await json<{ images: SkipImage[] }>(await api(`/series/${seriesId}/skip-images`), 200)).images;

const BASE = "0f0f0f0f0f0f0f0f";
/** Lệch BASE 3 bit / 10 bit. */
const NEAR = "0f0f0f0f0f0f0f08";
const FAR = "f03f0f0f0f0f0f0f";
const credit = { dhash: BASE, width: 800, height: 1200 };

describe("series skip images", () => {
  it("rejects a malformed hash", async () => {
    const s = await newSeries("Credit bad hash");
    const file = { name: "1.png", content_type: "image/png", bytes: 10, dhash: "0", width: 1, height: 1 };
    expect(
      (await api("/chapters", { method: "POST", body: { series_id: s, number: "1", files: [file] } })).status,
    ).toBe(400);
  });

  it("a learned credit is skipped in the next chapter only when hash and aspect ratio match", async () => {
    const s = await newSeries("Credit match");
    const one = await draft(s, "1", [{ dhash: "ffffffffffffffff", width: 800, height: 3000 }, credit]);
    expect(one.files.map((f) => f.skip)).toEqual([null, null]);
    expect(await json(await learn(s, { source_file_id: one.files[1]?.id as string }), 200)).toEqual({
      learned: 1,
      known: 0,
    });

    const two = await draft(s, "2", [
      { dhash: NEAR, width: 400, height: 600 },
      { dhash: FAR, width: 800, height: 1200 },
      { dhash: BASE, width: 800, height: 1000 },
      {},
      { dhash: BASE, width: 800, height: 1200 },
    ]);
    expect(two.files.map((f) => f.skip)).toEqual(["credit", null, null, null, "credit"]);
    // Ảnh tự bỏ khôi phục được như ảnh xoá tay; commit chỉ lấy ảnh còn dùng.
    await json(
      await api(`/chapters/${two.ch}/source-files/${two.files[0]?.id}`, { method: "PATCH", body: { skip: null } }),
      200,
    );
    expect(
      (await json<{ accepted: number }>(await api(`/chapters/${two.ch}/commit`, { method: "POST", body: {} }), 202))
        .accepted,
    ).toBe(4);
    await json(await api(`/chapters/${two.ch}/cancel`, { method: "POST", body: {} }), 200);

    // Series khác không bị ảnh hưởng.
    const other = await newSeries("Credit other");
    expect((await draft(other, "1", [credit])).files.map((f) => f.skip)).toEqual([null]);
  });

  it("learning keeps one copy per image, lists signed thumbnails, deletes row and copy", async () => {
    const s = await newSeries("Credit manage");
    const one = await draft(s, "1", [credit, {}]);
    const [withHash, noHash] = one.files as [{ id: string; skip: string | null }, { id: string; skip: string | null }];
    expect((await json<{ error: string }>(await learn(s, { source_file_id: noHash.id }), 409)).error).toBe("no_hash");
    // Ảnh gần trơn (hash gần hết bit 0) không học: trang trắng / khoảng trống giữa slice cũng ra hash như vậy.
    const plain = await draft(s, "0", [{ dhash: "0000000000000001", width: 800, height: 1200 }]);
    expect(
      (await json<{ error: string }>(await learn(s, { source_file_id: plain.files[0]?.id as string }), 409)).error,
    ).toBe("plain_image");
    await json(await learn(s, { source_file_id: withHash.id }), 200);
    // Học lại (hoặc ảnh gần giống ở chương khác) → không tạo bản sao.
    expect(await json(await learn(s, { source_file_id: withHash.id }), 200)).toEqual({ learned: 0, known: 1 });
    const two = await draft(s, "2", [{ dhash: NEAR, width: 800, height: 1200 }]);
    expect(await json(await learn(s, { source_file_id: two.files[0]?.id as string }), 200)).toEqual({
      learned: 0,
      known: 1,
    });

    const [img] = await list(s);
    expect(img).toMatchObject({ width: 800, height: 1200 });
    expect((await fetch(img?.url ?? "")).status).toBe(200);
    const [row] = await db.select().from(seriesSkipImages).where(eq(seriesSkipImages.seriesId, s));
    expect(row?.learnedFromChapterId).toBe(one.ch);
    expect(row?.thumbKey.startsWith(`u/${A.userId}/series/${s}/`)).toBe(true);

    // Body phải có đúng 1 nguồn.
    expect((await learn(s, {})).status).toBe(400);
    expect((await learn(s, { source_file_id: withHash.id, page_id: withHash.id })).status).toBe(400);
    // Ảnh của chương thuộc series khác → 404.
    const other = await newSeries("Credit manage other");
    expect((await learn(other, { source_file_id: withHash.id })).status).toBe(404);

    expect((await api(`/series/${other}/skip-images/${img?.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await api(`/series/${s}/skip-images/${img?.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await list(s)).toEqual([]);
    expect(await head(row?.thumbKey ?? "")).toBeNull();
    expect((await draft(s, "3", [credit])).files.map((f) => f.skip)).toEqual([null]);
  });

  it("two learns of the same image at once keep a single copy", async () => {
    const s = await newSeries("Credit race");
    const { files } = await draft(s, "1", [credit]);
    const body = { source_file_id: files[0]?.id as string };
    const results = await Promise.all([learn(s, body), learn(s, body), learn(s, body)]);
    const counts = await Promise.all(results.map((r) => json<{ learned: number }>(r, 200)));
    expect(counts.map((c) => c.learned).sort()).toEqual([0, 0, 1]);
    expect(await list(s)).toHaveLength(1);
  });

  it("learning from a page takes only the images lying wholly inside it", async () => {
    const s = await newSeries("Credit page");
    const { ch, files } = await draft(s, "1", [credit, { dhash: "ffffffffffffffff", width: 800, height: 3000 }, {}]);
    const [a, b, c] = files.map((f) => f.id) as [string, string, string];
    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    await makeRunnable();
    const ij = (await claimJobs(token, { caps: ["chapter.ingest"], max: 4 })).find(
      (j) => j.payload.chapter_id === ch,
    ) as Claimed;
    expect((await doIngest(token, ij)).status).toBe(200);
    // Trang 0 = trọn ảnh a + nửa đầu b; trang 1 = nửa sau b + ảnh c (không hash); trang 2 = c.
    const rows = (await db.select().from(pages).where(eq(pages.chapterId, ch))).sort((x, y) => x.ord - y.ord);
    const maps = [
      [
        { source_file_id: a, src_y: 0, page_y: 0, h: 1200 },
        { source_file_id: b, src_y: 0, page_y: 1200, h: 1500 },
      ],
      [
        { source_file_id: b, src_y: 1500, page_y: 0, h: 1500 },
        { source_file_id: c, src_y: 0, page_y: 1500, h: 100 },
      ],
      [{ source_file_id: c, src_y: 100, page_y: 0, h: 100 }],
    ];
    for (const [i, p] of rows.entries()) await db.update(pages).set({ sourceMap: maps[i] }).where(eq(pages.id, p.id));

    expect(await json(await learn(s, { page_id: rows[0]?.id as string }), 200)).toEqual({ learned: 1, known: 0 });
    expect((await list(s)).map((i) => [i.width, i.height])).toEqual([[800, 1200]]);
    // Trang 1 không chứa trọn ảnh nào → không học được gì.
    expect((await json<{ error: string }>(await learn(s, { page_id: rows[1]?.id as string }), 409)).error).toBe(
      "no_whole_image",
    );
    await json(await api(`/chapters/${ch}/cancel`, { method: "POST", body: {} }), 200);
  });

  it("other users can neither read, learn into nor delete a series' images", async () => {
    const B = await seedUser("skipimg-b");
    const s = await newSeries("Credit tenant");
    const { files } = await draft(s, "1", [credit]);
    await json(await learn(s, { source_file_id: files[0]?.id as string }), 200);
    const [img] = await list(s);
    const asB = (path: string, init: { method?: string; body?: unknown } = {}) =>
      call(`/api${path}`, { cookie: B.cookie, ...init });
    expect((await asB(`/series/${s}/skip-images`)).status).toBe(404);
    expect((await asB(`/series/${s}/skip-images/${img?.id}`, { method: "DELETE" })).status).toBe(404);
    expect(
      (await asB(`/series/${B.seriesId}/skip-images`, { method: "POST", body: { source_file_id: files[0]?.id } }))
        .status,
    ).toBe(404);
    expect((await call(`/api/series/${B.seriesId}/skip-images`, { cookie: A.cookie })).status).toBe(404);
    expect(await list(s)).toHaveLength(1);
  });

  it("deleting the series removes its learned images and their copies", async () => {
    const s = await newSeries("Credit delete");
    const { files } = await draft(s, "1", [credit]);
    await json(await learn(s, { source_file_id: files[0]?.id as string }), 200);
    const [row] = await db.select().from(seriesSkipImages).where(eq(seriesSkipImages.seriesId, s));
    expect(await head(row?.thumbKey ?? "")).not.toBeNull();
    expect((await api(`/series/${s}`, { method: "DELETE" })).status).toBe(204);
    expect(await db.select().from(seriesSkipImages).where(eq(seriesSkipImages.seriesId, s))).toEqual([]);
    expect(await deletePrefix(`u/${A.userId}/series/${s}/`)).toBe(0);
    expect(
      await db
        .select()
        .from(sourceFiles)
        .where(eq(sourceFiles.id, files[0]?.id as string)),
    ).toEqual([]);
  });
});
