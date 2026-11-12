/**
 * Ảnh credit series đã học: học từ ảnh gốc / trang, chương mới có ảnh khớp bị bỏ qua sẵn ('credit'), xem, xoá, dọn
 * khi xoá series.
 */
import { pages, seriesSkipImages, sourceFiles } from "@mtl/db";
import { MIN_BAND_PX } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deletePrefix, head } from "../src/storage.ts";
import { call, db, seedUser } from "./helpers.ts";
import { type Claimed, claimJobs, doIngest, makeRunnable, PNG_1PX, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Upload = { id: string; url: string; fields: Record<string, string> };
type Fp = { dhash?: string; width?: number; height?: number; trim?: { top: number; bottom: number } };
type SkipImage = { id: string; width: number; height: number; url: string; edge: "top" | "bottom" | null };

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
  const detail = await json<{
    source_files: { id: string; skip: string | null; trim: { top: number; bottom: number; by: string } | null }[];
  }>(await api(`/chapters/${created.chapter.id}`), 200);
  return { ch: created.chapter.id, files: detail.source_files };
}

const learn = (seriesId: string, body: Record<string, unknown>) =>
  api(`/series/${seriesId}/skip-images`, { method: "POST", body });
/** `bandPx` mặc định = trim đang lưu của mép đó (như trình duyệt vừa băm đúng dải đã cắt). */
async function learnBand(seriesId: string, sourceFileId: string, edge: string, dhash = BASE, bandPx?: number) {
  const [row] = await db.select().from(sourceFiles).where(eq(sourceFiles.id, sourceFileId));
  const stored = (row?.trim as Record<string, number> | null)?.[edge] ?? 0;
  return learn(seriesId, { source_file_id: sourceFileId, edge, dhash, band_px: bandPx ?? Math.max(1, stored) });
}
const trimFile = async (ch: string, fileId: string, trim: { top: number; bottom: number }) =>
  json(await api(`/chapters/${ch}/source-files/${fileId}`, { method: "PATCH", body: { trim } }), 200);
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
    const [withHash, noHash] = one.files as [(typeof one.files)[number], (typeof one.files)[number]];
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

  it("a page never counts a trimmed image as a whole image to learn", async () => {
    const s = await newSeries("Credit trimmed");
    const { ch, files } = await draft(s, "1", [credit]);
    const a = files[0]?.id as string;
    await json(await api(`/chapters/${ch}/commit`, { method: "POST", body: {} }), 202);
    await makeRunnable();
    const ij = (await claimJobs(token, { caps: ["chapter.ingest"], max: 4 })).find(
      (j) => j.payload.chapter_id === ch,
    ) as Claimed;
    expect((await doIngest(token, ij)).status).toBe(200);
    const [page] = await db.select().from(pages).where(eq(pages.chapterId, ch));
    await db
      .update(pages)
      .set({ sourceMap: [{ source_file_id: a, src_y: 0, page_y: 0, h: 1200 }] })
      .where(eq(pages.id, page?.id as string));
    await db
      .update(sourceFiles)
      .set({ trim: { top: 100, bottom: 0, by: "user" } })
      .where(eq(sourceFiles.id, a));
    expect((await json<{ error: string }>(await learn(s, { page_id: page?.id as string }), 409)).error).toBe(
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

  describe("edge bands", () => {
    it("learns the trimmed band of an image and lists it with its edge, width and server-side height", async () => {
      const s = await newSeries("Band learn");
      const { ch, files } = await draft(s, "1", [credit]);
      const id = files[0]?.id as string;
      await trimFile(ch, id, { top: 120, bottom: 0 });
      expect(await json(await learnBand(s, id, "top"), 200)).toEqual({ learned: 1, known: 0 });
      const [img] = await list(s);
      expect(img).toMatchObject({ edge: "top", dhash: BASE, width: 800, height: 120 });
      expect((await fetch(img?.url ?? "")).status).toBe(200);
      const [row] = await db.select().from(seriesSkipImages).where(eq(seriesSkipImages.seriesId, s));
      expect(row).toMatchObject({ edge: "top", dhash: BASE, learnedFromChapterId: ch });
      // Học lại cùng dải / dải gần giống (cùng mép, hash lệch ≤ 6 bit, chiều cao lệch ≤ 5%) → đã học.
      expect(await json(await learnBand(s, id, "top"), 200)).toEqual({ learned: 0, known: 1 });
      await trimFile(ch, id, { top: 123, bottom: 300 });
      expect(await json(await learnBand(s, id, "top", NEAR), 200)).toEqual({ learned: 0, known: 1 });
      // Cùng hash nhưng mép khác, hoặc chiều cao lệch quá 5% → dải mới.
      expect(await json(await learnBand(s, id, "bottom"), 200)).toEqual({ learned: 1, known: 0 });
      await trimFile(ch, id, { top: 200, bottom: 300 });
      expect(await json(await learnBand(s, id, "top"), 200)).toEqual({ learned: 1, known: 0 });
      expect((await list(s)).map((i) => [i.edge, i.height])).toEqual([
        ["top", 120],
        ["bottom", 300],
        ["top", 200],
      ]);
      // Xoá như mục cũ.
      const [first] = await list(s);
      expect((await api(`/series/${s}/skip-images/${first?.id}`, { method: "DELETE" })).status).toBe(204);
      expect(await list(s)).toHaveLength(2);
    });

    it("rejects an edge without a trim, a malformed or plain hash, and a bad body", async () => {
      const s = await newSeries("Band reject");
      const { ch, files } = await draft(s, "1", [credit]);
      const id = files[0]?.id as string;
      expect((await json<{ error: string }>(await learnBand(s, id, "top"), 409)).error).toBe("no_trim");
      await trimFile(ch, id, { top: 100, bottom: 0 });
      expect((await json<{ error: string }>(await learnBand(s, id, "bottom"), 409)).error).toBe("no_trim");
      expect((await learnBand(s, id, "top", "xyz")).status).toBe(400);
      expect((await learnBand(s, id, "middle")).status).toBe(400);
      expect((await learn(s, { source_file_id: id, edge: "top" })).status).toBe(400);
      expect((await learn(s, { page_id: id, edge: "top", dhash: BASE })).status).toBe(400);
      expect((await json<{ error: string }>(await learnBand(s, id, "top", "0000000000000001"), 409)).error).toBe(
        "plain_image",
      );
      expect(await list(s)).toEqual([]);
    });

    it("rejects a band whose size differs from the saved trim, and one too thin to match", async () => {
      const s = await newSeries("Band size");
      const { ch, files } = await draft(s, "1", [credit]);
      const id = files[0]?.id as string;
      await trimFile(ch, id, { top: 150, bottom: MIN_BAND_PX - 1 });
      const err = async (edge: string, bandPx?: number) =>
        (await json<{ error: string }>(await learnBand(s, id, edge, BASE, bandPx), 409)).error;
      expect(await err("top", 100)).toBe("trim_changed");
      expect(await err("bottom", MIN_BAND_PX)).toBe("trim_changed");
      expect(await err("bottom")).toBe("band_too_small");
      expect((await learn(s, { source_file_id: id, edge: "top", dhash: BASE })).status).toBe(400);
      await trimFile(ch, id, { top: 150, bottom: MIN_BAND_PX });
      expect(await json(await learnBand(s, id, "bottom"), 200)).toEqual({ learned: 1, known: 0 });
      expect(await list(s)).toHaveLength(1);
    });

    it("an image without a stored width cannot learn a band", async () => {
      const s = await newSeries("Band no size");
      const { ch, files } = await draft(s, "1", [{}]);
      const id = files[0]?.id as string;
      await json(
        await api(`/chapters/${ch}/source-files/${id}`, {
          method: "PATCH",
          body: { trim: { top: 100, bottom: 0 }, height: 900 },
        }),
        200,
      );
      expect((await json<{ error: string }>(await learnBand(s, id, "top"), 409)).error).toBe("no_hash");
    });

    it("shares the per-series limit with whole images and scopes to the series", async () => {
      const s = await newSeries("Band limit");
      const { ch, files } = await draft(s, "1", [credit]);
      const id = files[0]?.id as string;
      await trimFile(ch, id, { top: 100, bottom: 0 });
      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: crypto.randomUUID(),
        userId: A.userId,
        seriesId: s,
        dhash: i.toString(16).padStart(16, "0"),
        width: 800,
        height: 1200,
        thumbKey: `u/${A.userId}/series/${s}/filler-${i}.png`,
      }));
      await db.insert(seriesSkipImages).values(rows);
      expect((await json<{ error: string }>(await learnBand(s, id, "top"), 409)).error).toBe("skip_images_full");
      const other = await newSeries("Band other");
      expect((await learnBand(other, id, "top")).status).toBe(404);
    });

    it("bands never match whole images and whole images never match bands", async () => {
      const s = await newSeries("Band matcher");
      const one = await draft(s, "1", [credit]);
      const id = one.files[0]?.id as string;
      await trimFile(one.ch, id, { top: 1200 - 64, bottom: 0 });
      // Dải 800x1136 có cùng hash + tỉ lệ khung với một ảnh cả tấm 800x1136.
      await json(await learnBand(s, id, "top"), 200);
      const two = await draft(s, "2", [{ dhash: BASE, width: 800, height: 1136 }]);
      expect(two.files.map((f) => f.skip)).toEqual([null]);
      // Học ảnh cả tấm sau đó vẫn hoạt động bình thường, không bị dải chặn là "đã học".
      expect(await json(await learn(s, { source_file_id: two.files[0]?.id as string }), 200)).toEqual({
        learned: 1,
        known: 0,
      });
      const three = await draft(s, "3", [{ dhash: BASE, width: 800, height: 1136 }]);
      expect(three.files.map((f) => f.skip)).toEqual(["credit"]);
    });
  });
});

describe("trim given when the chapter is created", () => {
  it("stores it as credit-set, keeps the saved height, and drops it when it does not fit or is empty", async () => {
    const s = await newSeries("Trim on create");
    const base = { dhash: "0f0f0f0f0f0f0f0f", width: 800 };
    const d = await draft(s, "1", [
      { ...base, height: 1000, trim: { top: 0, bottom: 120 } },
      { ...base, height: 1000, trim: { top: 30, bottom: 80 } },
      // Chừa lại 63px < tối thiểu → bỏ cắt riêng ảnh này, chương vẫn tạo.
      { ...base, height: 1000, trim: { top: 500, bottom: 437 } },
      // Không biết chiều cao → không kiểm được biên.
      { trim: { top: 10, bottom: 10 } },
      { ...base, height: 1000, trim: { top: 0, bottom: 0 } },
      { ...base, height: 1000 },
    ]);
    expect(d.files.map((f) => f.trim)).toEqual([
      { top: 0, bottom: 120, by: "credit" },
      { top: 30, bottom: 80, by: "credit" },
      null,
      null,
      null,
      null,
    ]);
  });

  it("rejects negative or oversized pixel values", async () => {
    const s = await newSeries("Trim bad values");
    const file = { name: "1.png", content_type: "image/png", bytes: 10, dhash: BASE, width: 800, height: 1000 };
    for (const trim of [
      { top: -1, bottom: 0 },
      { top: 0, bottom: 3_000_000_000 },
      { top: 1.5, bottom: 0 },
      { top: 1 },
    ]) {
      const res = await api("/chapters", {
        method: "POST",
        body: { series_id: s, number: "1", files: [{ ...file, trim }] },
      });
      expect(res.status).toBe(400);
    }
  });

  it("an image skipped as a learned credit loses its trim; the others keep theirs", async () => {
    const s = await newSeries("Trim vs credit");
    const one = await draft(s, "1", [credit]);
    await json(await learn(s, { source_file_id: one.files[0]?.id as string }), 200);
    const two = await draft(s, "2", [
      { ...credit, trim: { top: 0, bottom: 100 } },
      { dhash: FAR, width: 800, height: 1200, trim: { top: 0, bottom: 100 } },
    ]);
    expect(two.files.map((f) => [f.skip, f.trim])).toEqual([
      ["credit", null],
      [null, { top: 0, bottom: 100, by: "credit" }],
    ]);
  });
});
