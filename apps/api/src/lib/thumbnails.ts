/**
 * Thumbnail WebP + ảnh bìa series bằng sharp. Giải mã strip cao hàng chục nghìn px tốn RAM → tối đa 2 ảnh xử lý cùng
 * lúc trong process API, mỗi ảnh 1 luồng libvips, và ảnh quá số điểm ảnh bị từ chối trước khi giải mã.
 */
import { apiErrorMessageVi, splitApiErrorCode } from "@mtl/shared";
import sharp, { type Metadata, type Sharp } from "sharp";

sharp.concurrency(1);
// Không giữ cache thao tác/file của libvips: ảnh mỗi lần một khác, cache chỉ ăn RAM.
sharp.cache(false);

export const THUMB_WIDTH = 300;
/** Thumbnail cắt phần trên theo tỉ lệ 3:4 (rộng:cao). */
const THUMB_ASPECT = 4 / 3;
const THUMB_QUALITY = 75;
export const COVER_WIDTH = 600;
export const COVER_HEIGHT = 800;
/** Trần số điểm ảnh giải mã (strip 1000×40000 = 40 MP vẫn qua). */
export const MAX_INPUT_PIXELS = 100_000_000;
const CONCURRENCY = 2;

export type ThumbTrim = { top: number; bottom: number };

type ImageErrorCode = "invalid_image" | "invalid_image.no_size" | "image_too_large" | "unsupported_format";

/**
 * Ảnh không đọc được (hỏng / không phải ảnh) hoặc quá khổ — route map sang 4xx. `apiCode` = mã lỗi API đầy đủ (có thể
 * kèm biến thể), `code` = phần mã ổn định.
 */
export class ImageError extends Error {
  readonly code: string;
  constructor(readonly apiCode: ImageErrorCode) {
    super(apiErrorMessageVi(apiCode));
    this.name = "ImageError";
    this.code = splitApiErrorCode(apiCode).error;
  }
}

/** Hàng đợi promise: tối đa `limit` tác vụ chạy cùng lúc, còn lại xếp hàng theo thứ tự đến. */
export function createSemaphore(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next)
        next(); // giữ nguyên chỗ cho tác vụ kế tiếp
      else active--;
    }
  };
}

const limited = createSemaphore(CONCURRENCY);

async function readMeta(img: Sharp): Promise<{ width: number; height: number; format: string }> {
  let meta: Metadata;
  try {
    meta = await img.metadata();
  } catch (err) {
    throw asImageError(err);
  }
  // Kích thước sau khi xoay theo EXIF — khớp ảnh worker (exif_transpose) và toạ độ trim người dùng kéo trên ảnh đã xoay.
  const { width, height } = meta.autoOrient ?? meta;
  const { format } = meta;
  if (!width || !height || !format) throw new ImageError("invalid_image.no_size");
  if (width * height > MAX_INPUT_PIXELS) throw new ImageError("image_too_large");
  return { width, height, format };
}

/** Lỗi libvips lúc giải mã (file cắt cụt, vượt limitInputPixels…) → ImageError. */
function asImageError(err: unknown): ImageError {
  if (err instanceof ImageError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/pixel limit/i.test(msg)) return new ImageError("image_too_large");
  return new ImageError("invalid_image");
}

/**
 * Áp trim (mép trên/dưới), cắt phần trên theo 3:4, thu về rộng 300, WebP. Ảnh thấp hơn 3:4 giữ nguyên tỉ lệ thật.
 * Trim vô lý (ăn hết ảnh) thì bỏ qua.
 */
export function renderThumb(
  input: Uint8Array | (() => Promise<Uint8Array>),
  trim: ThumbTrim | null,
): Promise<Uint8Array> {
  return limited(async () => {
    // Đọc nguồn TRONG chỗ của semaphore → tối đa 2 ảnh gốc nằm trong RAM. Lỗi đọc (storage) không phải ImageError.
    const bytes = typeof input === "function" ? await input() : input;
    try {
      const src = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const img = sharp(src, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
      const { width, height } = await readMeta(img);
      let top = Math.max(0, trim?.top ?? 0);
      let bottom = Math.max(0, trim?.bottom ?? 0);
      if (top + bottom >= height) {
        top = 0;
        bottom = 0;
      }
      const cropHeight = Math.min(height - top - bottom, Math.round(width * THUMB_ASPECT));
      const out = await img
        .extract({ left: 0, top, width, height: cropHeight })
        .resize(THUMB_WIDTH)
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
      return new Uint8Array(out);
    } catch (err) {
      throw asImageError(err);
    }
  });
}

const COVER_FORMATS = new Set(["png", "jpeg", "webp"]);

/** Ảnh bìa 600×800 WebP (cắt theo phần trên). Định dạng kiểm bằng nội dung, không tin Content-Type. */
export function renderCover(input: Uint8Array): Promise<Uint8Array> {
  return limited(async () => {
    try {
      const src = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
      const img = sharp(src, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
      const { format } = await readMeta(img);
      if (!COVER_FORMATS.has(format)) throw new ImageError("unsupported_format");
      const out = await img
        .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "top" })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();
      return new Uint8Array(out);
    } catch (err) {
      throw asImageError(err);
    }
  });
}
