/** Thumbnail / bìa bằng sharp: vùng cắt 3:4, trim, ảnh ngắn, ảnh hỏng, ảnh quá khổ, semaphore. */
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createSemaphore, ImageError, renderCover, renderThumb } from "../../src/lib/thumbnails.ts";

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

const solid = (width: number, height: number, background = BLUE) =>
  sharp({ create: { width, height, channels: 3, background } });

/** Ảnh `width`×`height`, `redRows` hàng trên cùng đỏ, phần còn lại xanh. */
async function banded(width: number, height: number, redRows: number) {
  const red = await solid(width, redRows, RED).png().toBuffer();
  return solid(width, height)
    .composite([{ input: red, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

const meta = async (b: Uint8Array) => sharp(b).metadata();

/** JPEG lưu ngang 1600×1200 (1/3 trái đỏ) + EXIF orientation 6 → hiển thị dọc 1200×1600, đỏ ở trên. */
async function rotatedPhoto() {
  const red = await solid(400, 1200, RED).png().toBuffer();
  return solid(1600, 1200)
    .composite([{ input: red, top: 0, left: 0 }])
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}
async function pixel(b: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i] as number, g: data[i + 1] as number, b: data[i + 2] as number };
}

describe("renderThumb", () => {
  it("crops a tall strip to 300x400 WebP, small", async () => {
    const out = await renderThumb(await banded(800, 12000, 3000), null);
    const m = await meta(out);
    expect([m.format, m.width, m.height]).toEqual(["webp", 300, 400]);
    expect(out.byteLength).toBeLessThan(40 * 1024);
  });

  it("keeps the real aspect ratio of an image shorter than 3:4", async () => {
    const m = await meta(await renderThumb(await solid(800, 600).png().toBuffer(), null));
    expect([m.width, m.height]).toEqual([300, 225]);
  });

  it("starts the crop at trim.top and ends before trim.bottom", async () => {
    const src = await banded(600, 3000, 500);
    const plain = await renderThumb(src, null);
    expect(await pixel(plain, 150, 10)).toMatchObject({ r: expect.any(Number) });
    expect((await pixel(plain, 150, 10)).r).toBeGreaterThan(200);
    const trimmed = await renderThumb(src, { top: 500, bottom: 0 });
    const p = await pixel(trimmed, 150, 10);
    expect(p.r).toBeLessThan(60);
    expect(p.b).toBeGreaterThan(200);
    // bottom trim shortens the available area: 600x800 image, trim 700 top + 50 bottom -> 50px left -> 300x25
    const short = await meta(await renderThumb(await solid(600, 800).png().toBuffer(), { top: 700, bottom: 50 }));
    expect([short.width, short.height]).toEqual([300, 25]);
  });

  it("ignores a trim that would swallow the whole image", async () => {
    const m = await meta(await renderThumb(await solid(300, 400).png().toBuffer(), { top: 300, bottom: 300 }));
    expect([m.width, m.height]).toEqual([300, 400]);
  });

  it("rejects empty and non-image input with invalid_image", async () => {
    for (const bad of [new Uint8Array(), new TextEncoder().encode("not an image at all")]) {
      await expect(renderThumb(bad, null)).rejects.toMatchObject({ code: "invalid_image" });
    }
  });

  it("rejects an image above the pixel limit before decoding", async () => {
    // PNG 1x1 với IHDR sửa thành 20000x20000 (400 MP) + CRC đúng: chỉ cần header để bị chặn.
    const png = Buffer.from(await solid(1, 1).png().toBuffer());
    png.writeUInt32BE(20000, 16);
    png.writeUInt32BE(20000, 20);
    png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
    const err = await renderThumb(png, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageError);
    expect((err as ImageError).code).toBe("image_too_large");
  });
});

describe("renderThumb loader", () => {
  it("reads the source inside the semaphore: at most 2 sources loaded at once, slot freed when the loader throws", async () => {
    const img = await solid(60, 80).png().toBuffer();
    let loaded = 0;
    let peak = 0;
    const loader = async () => {
      loaded++;
      peak = Math.max(peak, loaded);
      await new Promise((r) => setTimeout(r, 15));
      return img;
    };
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const out = await renderThumb(loader, null);
        expect(out.byteLength).toBeGreaterThan(0);
        loaded--;
      }),
    );
    // `loaded--` chạy 1 tick sau khi nhả chỗ (loader kế đã bắt đầu) nên đỉnh đo được tối đa 3; không đọc trong slot thì là 6.
    expect(peak).toBeLessThanOrEqual(3);

    await expect(
      renderThumb(async () => {
        throw new Error("s3 down");
      }, null),
    ).rejects.toThrow("s3 down"); // not mapped to ImageError
    expect((await meta(await renderThumb(img, null))).width).toBe(300);
  });
});

describe("renderThumb EXIF", () => {
  it("crops the displayed (EXIF-rotated) image, not the stored one", async () => {
    const out = await renderThumb(await rotatedPhoto(), null);
    const m = await meta(out);
    expect([m.width, m.height]).toEqual([300, 400]);
    expect((await pixel(out, 150, 5)).r).toBeGreaterThan(200);
    expect((await pixel(out, 150, 395)).b).toBeGreaterThan(200);
  });
});

describe("renderCover", () => {
  it("makes a 600x800 WebP taken from the top of the image", async () => {
    const out = await renderCover(await banded(900, 3000, 400));
    const m = await meta(out);
    expect([m.format, m.width, m.height]).toEqual(["webp", 600, 800]);
    expect((await pixel(out, 300, 5)).r).toBeGreaterThan(200);
  });

  it("rejects formats outside png/jpeg/webp by content", async () => {
    const gif = await solid(10, 10).gif().toBuffer();
    await expect(renderCover(gif)).rejects.toMatchObject({ code: "unsupported_format" });
    await expect(renderCover(new TextEncoder().encode("<html>"))).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("follows the EXIF orientation like the worker does", async () => {
    const out = await renderCover(await rotatedPhoto());
    expect((await pixel(out, 300, 10)).r).toBeGreaterThan(200);
    expect((await pixel(out, 300, 790)).b).toBeGreaterThan(200);
  });

  it("accepts jpeg and webp", async () => {
    for (const buf of [await solid(50, 80).jpeg().toBuffer(), await solid(50, 80).webp().toBuffer()]) {
      expect((await meta(await renderCover(buf))).width).toBe(600);
    }
  });
});

describe("createSemaphore", () => {
  it("never runs more than `limit` tasks at once and runs them all", async () => {
    const run = createSemaphore(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    };
    await Promise.all(Array.from({ length: 7 }, () => run(task)));
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("releases the slot when a task throws", async () => {
    const run = createSemaphore(1);
    await expect(
      run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(run(async () => "ok")).resolves.toBe("ok");
  });
});
