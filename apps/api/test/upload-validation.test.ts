/**
 * Upload chương (red team #12): presigned POST giới hạn dung lượng/Content-Type, commit kiểm HEAD + magic bytes.
 * Cần MinIO dev (pnpm infra:up).
 */
import { jobs, sourceFiles } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, sniffImageMime, validateUploaded } from "../src/routes/chapters.ts";
import { head } from "../src/storage.ts";
import { call, db, seedWorkspace } from "./helpers.ts";
import { PNG_1PX } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
type Upload = { id: string; ord: number; name: string; url: string; fields: Record<string, string> };

let A: Seed;
beforeAll(async () => {
  A = await seedWorkspace("upl");
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]);
const WEBP = Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1");
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");

async function postFile(u: Pick<Upload, "url" | "fields">, body: Uint8Array, contentType?: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(u.fields)) form.append(k, k === "Content-Type" && contentType ? contentType : v);
  form.append("file", new Blob([body]));
  return fetch(u.url, { method: "POST", body: form });
}

async function createChapter(files: { name: string; content_type: string; bytes: number }[], number = "1") {
  const res = await call(`/api/w/${A.workspaceId}/chapters`, {
    method: "POST",
    cookie: A.cookie,
    body: { series_id: A.seriesId, number, files },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { chapter: { id: string; status: string }; files: Upload[] };
}

describe("magic bytes", () => {
  it("recognises png/jpeg/webp and nothing else", () => {
    expect(sniffImageMime(PNG_1PX.subarray(0, 16))).toBe("image/png");
    expect(sniffImageMime(JPEG.subarray(0, 16))).toBe("image/jpeg");
    expect(sniffImageMime(WEBP.subarray(0, 16))).toBe("image/webp");
    expect(sniffImageMime(HTML.subarray(0, 16))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });

  it("validateUploaded: missing / too large / mismatch / ok", () => {
    expect(validateUploaded("image/png", null)).toBe("missing");
    expect(validateUploaded("image/png", { bytes: MAX_FILE_BYTES + 1, prefix: PNG_1PX })).toBe("too_large");
    expect(validateUploaded("image/png", { bytes: 10, prefix: JPEG })).toBe("type_mismatch");
    expect(validateUploaded("image/jpeg", { bytes: 10, prefix: JPEG })).toBeNull();
  });
});

describe("chapter create + presigned POST", () => {
  it("validates the file list (type, size, count)", async () => {
    const bad = async (files: unknown[]) =>
      (
        await call(`/api/w/${A.workspaceId}/chapters`, {
          method: "POST",
          cookie: A.cookie,
          body: { series_id: A.seriesId, number: "9", files },
        })
      ).status;
    expect(await bad([{ name: "a.gif", content_type: "image/gif", bytes: 10 }])).toBe(400);
    expect(await bad([{ name: "a.png", content_type: "image/png", bytes: MAX_FILE_BYTES + 1 }])).toBe(400);
    expect(await bad([])).toBe(400);
    const many = Array.from({ length: 401 }, (_, i) => ({ name: `${i}.png`, content_type: "image/png", bytes: 10 }));
    expect(await bad(many)).toBe(400);
  });

  it("MinIO rejects a direct 50MB upload and a wrong Content-Type (policy, not the UI)", async () => {
    const { files } = await createChapter([{ name: "001.png", content_type: "image/png", bytes: MAX_FILE_BYTES }]);
    const u = files[0] as Upload;
    const big = new Uint8Array(50 * 1024 * 1024);
    big.set(PNG_1PX);
    expect((await postFile(u, big)).status).toBeGreaterThanOrEqual(400);
    expect((await postFile(u, PNG_1PX, "text/html")).status).toBe(403);
    const key = (await db.select().from(sourceFiles).where(eq(sourceFiles.id, u.id)))[0]?.storageKey ?? "";
    expect(await head(key)).toBeNull();
  });

  it("re-presigns files of a draft chapter only", async () => {
    const { chapter, files } = await createChapter([{ name: "001.png", content_type: "image/png", bytes: 100 }]);
    const res = await call(`/api/w/${A.workspaceId}/chapters/${chapter.id}/presign`, {
      method: "POST",
      cookie: A.cookie,
      body: { file_ids: files.map((f) => f.id) },
    });
    expect(res.status).toBe(200);
    const again = ((await res.json()) as { files: Upload[] }).files[0] as Upload;
    expect((await postFile(again, PNG_1PX)).status).toBe(204);
  });
});

describe("commit", () => {
  it("drops an HTML file renamed .png and a missing file; enqueues only chapter.ingest", async () => {
    const { chapter, files } = await createChapter([
      { name: "001.png", content_type: "image/png", bytes: PNG_1PX.length },
      { name: "002.png", content_type: "image/png", bytes: HTML.length },
      { name: "003.jpg", content_type: "image/jpeg", bytes: JPEG.length },
      { name: "004.png", content_type: "image/png", bytes: 100 },
    ]);
    const [f1, f2, f3, f4] = files as [Upload, Upload, Upload, Upload];
    expect((await postFile(f1, PNG_1PX)).status).toBe(204);
    // Policy chỉ ép Content-Type header, không đọc nội dung → HTML lọt vào MinIO; commit phải loại.
    expect((await postFile(f2, HTML)).status).toBe(204);
    expect((await postFile(f3, JPEG)).status).toBe(204);
    // f4 không upload.

    const res = await call(`/api/w/${A.workspaceId}/chapters/${chapter.id}/commit`, {
      method: "POST",
      cookie: A.cookie,
      body: {},
    });
    expect(res.status, await res.clone().text()).toBe(202);
    const out = (await res.json()) as {
      job: { type: string };
      accepted: number;
      rejected: { id: string; reason: string }[];
    };
    expect(out.job.type).toBe("chapter.ingest");
    expect(out.accepted).toBe(2);
    expect(out.rejected).toEqual([
      { id: f2.id, ord: 1, reason: "type_mismatch" },
      { id: f4.id, ord: 3, reason: "missing" },
    ]);
    const left = await db.select().from(sourceFiles).where(eq(sourceFiles.chapterId, chapter.id));
    expect(left.map((f) => f.id).sort()).toEqual([f1.id, f3.id].sort());
    const js = await db.select().from(jobs).where(eq(jobs.chapterId, chapter.id));
    expect(js.map((j) => j.type)).toEqual(["chapter.ingest"]);

    const detail = await call(`/api/w/${A.workspaceId}/chapters/${chapter.id}`, { cookie: A.cookie });
    expect(((await detail.json()) as { status: string }).status).toBe("ingesting");

    // Đã commit → không ký upload thêm.
    const pre = await call(`/api/w/${A.workspaceId}/chapters/${chapter.id}/presign`, {
      method: "POST",
      cookie: A.cookie,
      body: { file_ids: [f1.id] },
    });
    expect(pre.status).toBe(409);
  });

  it("all files invalid → 400 and chapter stays draft", async () => {
    const { chapter, files } = await createChapter([
      { name: "001.png", content_type: "image/png", bytes: HTML.length },
    ]);
    expect((await postFile(files[0] as Upload, HTML)).status).toBe(204);
    const res = await call(`/api/w/${A.workspaceId}/chapters/${chapter.id}/commit`, {
      method: "POST",
      cookie: A.cookie,
      body: {},
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("no_valid_files");
    const detail = await call(`/api/w/${A.workspaceId}/chapters/${chapter.id}`, { cookie: A.cookie });
    expect(((await detail.json()) as { status: string }).status).toBe("draft");
  });
});
