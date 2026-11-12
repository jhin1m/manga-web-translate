/**
 * Dấu nhận dạng ảnh lúc thả file (trước khi tạo chương): kích thước + dHash để server bỏ qua sẵn ảnh credit series đã
 * học. Không giải mã được (định dạng lạ, ảnh quá cao trên Safari…) → null, không chặn upload.
 */
import { DHASH_H, DHASH_W, dhashFromGray, type ImageFingerprint } from "@mtl/shared";

const CONCURRENCY = 4;

/** dHash của vùng (sx, sy, sw, sh) trong `bmp`, thu về 9×8 xám. null nếu không có canvas 2D. */
function dhashOfRegion(bmp: ImageBitmap, sx: number, sy: number, sw: number, sh: number): string | null {
  const canvas = new OffscreenCanvas(DHASH_W, DHASH_H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, DHASH_W, DHASH_H);
  const rgba = ctx.getImageData(0, 0, DHASH_W, DHASH_H).data;
  const gray = new Uint8ClampedArray(DHASH_W * DHASH_H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.299 * (rgba[i * 4] as number) + 0.587 * (rgba[i * 4 + 1] as number) + 0.114 * (rgba[i * 4 + 2] as number);
  }
  return dhashFromGray(gray);
}

export async function fingerprint(blob: Blob): Promise<ImageFingerprint | null> {
  let bmp: ImageBitmap | undefined;
  try {
    bmp = await createImageBitmap(blob);
    const dhash = dhashOfRegion(bmp, 0, 0, bmp.width, bmp.height);
    return dhash ? { dhash, width: bmp.width, height: bmp.height } : null;
  } catch {
    return null;
  } finally {
    bmp?.close();
  }
}

/**
 * Dấu của dải `bandPx` px ở mép `edge` của ảnh (dải đã cắt: height = bandPx, width = bề rộng ảnh). Cùng cách thu 9×8
 * với `fingerprint` nên dải khớp được với dải đã học. null: không giải mã được, hoặc ảnh thấp hơn dải.
 */
export async function bandFingerprint(
  blob: Blob,
  edge: "top" | "bottom",
  bandPx: number,
): Promise<ImageFingerprint | null> {
  if (!Number.isInteger(bandPx) || bandPx <= 0) return null;
  let bmp: ImageBitmap | undefined;
  try {
    bmp = await createImageBitmap(blob);
    if (bmp.height < bandPx) return null;
    const sy = edge === "top" ? 0 : bmp.height - bandPx;
    const dhash = dhashOfRegion(bmp, 0, sy, bmp.width, bandPx);
    return dhash ? { dhash, width: bmp.width, height: bandPx } : null;
  } catch {
    return null;
  } finally {
    bmp?.close();
  }
}

/** Dấu của từng blob theo thứ tự, tối đa 4 ảnh giải mã cùng lúc. */
export async function fingerprintAll(
  blobs: Blob[],
  one: (b: Blob) => Promise<ImageFingerprint | null> = fingerprint,
): Promise<(ImageFingerprint | null)[]> {
  const out = new Array<ImageFingerprint | null>(blobs.length).fill(null);
  let next = 0;
  const run = async () => {
    for (let i = next++; i < blobs.length; i = next++) out[i] = await one(blobs[i] as Blob).catch(() => null);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, blobs.length) }, run));
  return out;
}
