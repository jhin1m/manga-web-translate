/**
 * Nạp font editor từ /fonts (bản sao worker/fonts — scripts/sync-fonts.ts) bằng FontFace, đợi
 * `document.fonts.ready`, và cấp metric từ manifest (không dùng metric trình duyệt — hợp đồng layout quy tắc 2).
 * `family` của FontFace = font_id nên canvas dùng `${size}px "${font_id}"`.
 */
import type { Layout } from "./actions.ts";
import { type FontMetrics, layoutBox, type MeasureFn } from "./measure.ts";

export type FontEntry = FontMetrics & { file: string; viComplete: boolean };
export type FontManifest = { version: number; defaults: string[]; fonts: Record<string, FontEntry> };

export type FontKit = {
  manifest: FontManifest;
  ids: string[];
  metrics(fontId: string): FontMetrics;
  measure: MeasureFn;
  layout: Layout;
};

/** Font thiếu trong manifest (state cũ/đổi bộ font) → metric font mặc định đầu tiên. */
function metricsOf(manifest: FontManifest, fontId: string): FontMetrics {
  const f = manifest.fonts[fontId] ?? manifest.fonts[manifest.defaults[0] ?? ""] ?? Object.values(manifest.fonts)[0];
  if (!f) throw new Error("font manifest rỗng");
  return { unitsPerEm: f.unitsPerEm, ascent: f.ascent, descent: f.descent };
}

/** Font cho box tạo tay: font thoại của series nếu manifest còn font đó, không thì font mặc định đầu tiên. */
export function dialogueFont(manifest: FontManifest, seriesFont: string | undefined): string {
  if (seriesFont && manifest.fonts[seriesFont]) return seriesFont;
  return manifest.defaults[0] ?? Object.keys(manifest.fonts)[0] ?? "Bangers-Regular";
}

export const canvasFont = (fontId: string, size: number) => `${size}px "${fontId}"`;

/** Đo advance bằng canvas 2D (cùng renderer với Konva). Cache theo (font, cỡ, chuỗi). */
function canvasMeasure(): MeasureFn {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("canvas 2D không khả dụng");
  const cache = new Map<string, number>();
  return (text, fontId, size) => {
    const key = `${fontId}|${size}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = canvasFont(fontId, size);
      w = ctx.measureText(text).width;
      if (cache.size > 20_000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}

let loading: Promise<FontKit> | null = null;

/** Nạp 1 lần cho cả tab. */
export function loadFonts(): Promise<FontKit> {
  loading ??= (async () => {
    const res = await fetch("/fonts/manifest.json");
    if (!res.ok) throw new Error(`không tải được manifest font (${res.status})`);
    const manifest = (await res.json()) as FontManifest;
    await Promise.all(
      Object.entries(manifest.fonts).map(async ([id, f]) => {
        const face = new FontFace(id, `url(/fonts/${encodeURIComponent(f.file)})`);
        document.fonts.add(await face.load());
      }),
    );
    await document.fonts.ready;
    const measure = canvasMeasure();
    const metrics = (id: string) => metricsOf(manifest, id);
    return {
      manifest,
      ids: Object.keys(manifest.fonts).sort(),
      metrics,
      measure,
      layout: (box) => layoutBox(box, metrics(box.font_family), measure),
    };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
