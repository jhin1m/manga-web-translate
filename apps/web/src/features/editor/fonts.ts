/**
 * Nạp font editor từ /fonts (bản sao worker/fonts — scripts/sync-fonts.ts) + font tuỳ chỉnh của workspace (URL
 * presigned từ API) bằng FontFace, đợi `document.fonts.ready`, và cấp metric từ manifest / API (không dùng metric
 * trình duyệt — hợp đồng layout quy tắc 2). `family` của FontFace = font_id nên canvas dùng `${size}px "${font_id}"`.
 * Font không biết (đã xoá, state cũ) → metric + nét vẽ đều theo font thoại mặc định.
 */
import type { Layout } from "./actions.ts";
import { type FontMetrics, layoutBox, type MeasureFn } from "./measure.ts";

export type FontEntry = FontMetrics & { file: string; viComplete: boolean };
export type FontManifest = { version: number; defaults: string[]; fonts: Record<string, FontEntry> };

/** Font tuỳ chỉnh của workspace (một phần của `WorkspaceFont` ở features/fonts/api.ts). */
export type CustomFont = {
  id: string;
  name: string;
  units_per_em: number;
  ascent: number;
  descent: number;
  url: string;
};

export type FontKit = {
  manifest: FontManifest;
  /** Id font gói sẵn. */
  ids: string[];
  /** Font tuỳ chỉnh đã nạp được (chọn được trong panel; nhóm "Font của nhóm"). */
  custom: { id: string; name: string }[];
  /** Id có font thật (gói sẵn hoặc tuỳ chỉnh đã nạp) — không thì metric/nét vẽ rơi về font mặc định. */
  knows(fontId: string): boolean;
  metrics(fontId: string): FontMetrics;
  measure: MeasureFn;
  layout: Layout;
};

/** Font thiếu (state cũ/đổi bộ font/font nhóm đã xoá) → metric font mặc định đầu tiên. */
function metricsOf(manifest: FontManifest, custom: ReadonlyMap<string, FontMetrics>, fontId: string): FontMetrics {
  const own = custom.get(fontId);
  if (own) return own;
  const f = manifest.fonts[fontId] ?? manifest.fonts[manifest.defaults[0] ?? ""] ?? Object.values(manifest.fonts)[0];
  if (!f) throw new Error("font manifest rỗng");
  return { unitsPerEm: f.unitsPerEm, ascent: f.ascent, descent: f.descent };
}

/**
 * Font cho box tạo tay: font thoại của series nếu còn dùng được (`isKnown`, mặc định: có trong manifest), không thì
 * font mặc định đầu tiên.
 */
export function dialogueFont(
  manifest: FontManifest,
  seriesFont: string | undefined,
  isKnown: (id: string) => boolean = (id) => id in manifest.fonts,
): string {
  if (seriesFont && isKnown(seriesFont)) return seriesFont;
  return manifest.defaults[0] ?? Object.keys(manifest.fonts)[0] ?? "Bangers-Regular";
}

/** Font mặc định khi `fontId` không có trong trình duyệt (trình duyệt tự dùng family thứ hai). */
let fallbackFamily = "Bangers-Regular";

export const canvasFont = (fontId: string, size: number) => `${size}px "${fontId}", "${fallbackFamily}"`;

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

type Base = { manifest: FontManifest; measure: MeasureFn };
let loading: Promise<Base> | null = null;

/** Gói sẵn: nạp 1 lần cho cả tab. */
function loadBase(): Promise<Base> {
  loading ??= (async () => {
    const res = await fetch("/fonts/manifest.json");
    if (!res.ok) throw new Error(`không tải được manifest font (${res.status})`);
    const manifest = (await res.json()) as FontManifest;
    fallbackFamily = manifest.defaults[0] ?? Object.keys(manifest.fonts)[0] ?? fallbackFamily;
    await Promise.all(
      Object.entries(manifest.fonts).map(async ([id, f]) => {
        const face = new FontFace(id, `url(/fonts/${encodeURIComponent(f.file)})`);
        document.fonts.add(await face.load());
      }),
    );
    await document.fonts.ready;
    return { manifest, measure: canvasMeasure() };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Font tuỳ chỉnh đã nạp vào `document.fonts` (id bất biến → không nạp lại). */
const loadedCustom = new Map<string, CustomFont>();

/** Nạp từng font; trả các font lỗi (VD URL presigned hết hạn). Một font hỏng không chặn font khác. */
async function loadCustomFaces(fonts: CustomFont[]): Promise<CustomFont[]> {
  const failed: CustomFont[] = [];
  await Promise.all(
    fonts.map(async (f) => {
      try {
        const face = new FontFace(f.id, `url(${JSON.stringify(f.url)})`);
        document.fonts.add(await face.load());
        loadedCustom.set(f.id, f);
      } catch {
        failed.push(f);
      }
    }),
  );
  return failed;
}

/**
 * Bộ font cho 1 phiên editor: gói sẵn + font workspace. `fetchCustom` lấy danh sách kèm URL mới; font nào nạp lỗi
 * (URL hết hạn) → lấy lại danh sách 1 lần rồi nạp lại. Không lấy được font nhóm → vẫn dùng được font gói sẵn.
 */
export async function loadFonts(fetchCustom?: () => Promise<CustomFont[]>): Promise<FontKit> {
  const { manifest, measure } = await loadBase();
  if (fetchCustom) {
    try {
      const fonts = await fetchCustom();
      const failed = await loadCustomFaces(fonts.filter((f) => !loadedCustom.has(f.id)));
      if (failed.length > 0) {
        const fresh = new Set(failed.map((f) => f.id));
        await loadCustomFaces((await fetchCustom()).filter((f) => fresh.has(f.id)));
      }
      const listed = new Set(fonts.map((f) => f.id));
      for (const id of loadedCustom.keys()) if (!listed.has(id)) loadedCustom.delete(id);
      await document.fonts.ready;
    } catch (e) {
      console.warn("không nạp được font của nhóm", e);
    }
  }
  const custom = new Map<string, FontMetrics>(
    [...loadedCustom.values()].map((f) => [f.id, { unitsPerEm: f.units_per_em, ascent: f.ascent, descent: f.descent }]),
  );
  const metrics = (id: string) => metricsOf(manifest, custom, id);
  return {
    manifest,
    ids: Object.keys(manifest.fonts).sort(),
    custom: [...loadedCustom.values()].map((f) => ({ id: f.id, name: f.name })),
    knows: (id) => id in manifest.fonts || custom.has(id),
    metrics,
    measure,
    layout: (box) => layoutBox(box, metrics(box.font_family), measure),
  };
}
