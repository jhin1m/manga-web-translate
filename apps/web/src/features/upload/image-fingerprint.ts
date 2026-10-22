/**
 * Dấu nhận dạng ảnh lúc thả file (trước khi tạo chương): kích thước + dHash để server bỏ qua sẵn ảnh credit series đã
 * học. Không giải mã được (định dạng lạ, ảnh quá cao trên Safari…) → null, không chặn upload.
 */
import { DHASH_H, DHASH_W, dhashFromGray, type ImageFingerprint } from "@mtl/shared";

const CONCURRENCY = 4;

export async function fingerprint(blob: Blob): Promise<ImageFingerprint | null> {
  let bmp: ImageBitmap | undefined;
  try {
    bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(DHASH_W, DHASH_H);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, DHASH_W, DHASH_H);
    const rgba = ctx.getImageData(0, 0, DHASH_W, DHASH_H).data;
    const gray = new Uint8ClampedArray(DHASH_W * DHASH_H);
    for (let i = 0; i < gray.length; i++) {
      gray[i] =
        0.299 * (rgba[i * 4] as number) + 0.587 * (rgba[i * 4 + 1] as number) + 0.114 * (rgba[i * 4 + 2] as number);
    }
    return { dhash: dhashFromGray(gray), width: bmp.width, height: bmp.height };
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
