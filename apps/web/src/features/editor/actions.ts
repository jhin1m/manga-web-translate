/**
 * Thao tác editor thuần (recipe immer trên PageState) — test unit không cần DOM. Mọi chuỗi chuẩn hoá NFC.
 * Thao tác đổi chữ/khung/kiểu chữ chạy lại layout qua `Layout` tiêm vào (browser: measure.ts + canvas).
 * Box/region tra theo id; không thấy id → không làm gì.
 */
import type { PageState, Region, TextBox } from "@mtl/shared";
import type { Draft } from "immer";
import { LINE_HEIGHT, nfc, PAD } from "./measure.ts";

export type Layout = (box: TextBox) => { lines: string[]; font_size: number };
export type BoxGeometry = Pick<TextBox, "x" | "y" | "w" | "h" | "rotation">;
/** Trường kiểu chữ sửa được từ panel thuộc tính. */
export type BoxStyle = Partial<
  Pick<
    TextBox,
    "font_family" | "font_size" | "line_height" | "pad" | "align" | "fill" | "stroke" | "auto_fit" | "hidden"
  >
>;

type S = Draft<PageState>;

const boxOf = (s: S, id: string) => s.text_boxes.find((b) => b.id === id);
const regionOf = (s: S, id: string) => s.regions.find((r) => r.id === id);

function relayout(box: Draft<TextBox>, layout: Layout) {
  const r = layout(box as TextBox);
  box.lines = r.lines.map(nfc);
  box.font_size = r.font_size;
}

export const moveBox = (id: string, x: number, y: number) => (s: S) => {
  const b = boxOf(s, id);
  if (!b) return;
  b.x = x;
  b.y = y;
};

/** Đổi khung (Transformer): bề rộng/cao đổi → ngắt dòng lại (auto_fit thì khớp lại cỡ chữ). */
export const resizeBox = (id: string, g: BoxGeometry, layout: Layout) => (s: S) => {
  const b = boxOf(s, id);
  if (!b) return;
  const relay = b.w !== g.w || b.h !== g.h;
  Object.assign(b, { x: g.x, y: g.y, w: Math.max(1, g.w), h: Math.max(1, g.h), rotation: g.rotation });
  if (relay) relayout(b, layout);
};

/** Sửa chữ của box; box gắn region → đồng bộ `region.translation`. */
export const editText = (id: string, text: string, layout: Layout) => (s: S) => {
  const b = boxOf(s, id);
  if (!b) return;
  b.text = nfc(text);
  relayout(b, layout);
  if (b.region_id) {
    const r = regionOf(s, b.region_id);
    if (r) r.translation = b.text;
  }
};

const LAYOUT_FIELDS = new Set<keyof BoxStyle>(["font_family", "font_size", "line_height", "pad", "auto_fit"]);

export const setStyle = (id: string, style: BoxStyle, layout: Layout) => (s: S) => {
  const b = boxOf(s, id);
  if (!b) return;
  Object.assign(b, style);
  if ((Object.keys(style) as (keyof BoxStyle)[]).some((k) => LAYOUT_FIELDS.has(k))) relayout(b, layout);
};

/** Áp cùng kiểu chữ cho nhiều box (1 bước undo) — "Áp kiểu cho khối cùng loại". */
export const setStyleMany = (ids: string[], style: BoxStyle, layout: Layout) => (s: S) => {
  for (const id of ids) setStyle(id, style, layout)(s);
};

export const addBox = (box: TextBox) => (s: S) => {
  if (boxOf(s, box.id)) return;
  s.text_boxes.push({ ...box, text: nfc(box.text), lines: box.lines.map(nfc) });
};

export const deleteBox = (id: string) => (s: S) => {
  const i = s.text_boxes.findIndex((b) => b.id === id);
  if (i >= 0) s.text_boxes.splice(i, 1);
};

/** Sửa bản dịch từ bảng region: cập nhật region + mọi box gắn region đó. */
export const setRegionTranslation = (regionId: string, text: string, layout: Layout) => (s: S) => {
  const r = regionOf(s, regionId);
  if (!r) return;
  r.translation = nfc(text);
  for (const b of s.text_boxes) {
    if (b.region_id !== regionId) continue;
    b.text = r.translation;
    relayout(b, layout);
  }
};

/**
 * Áp kết quả AI mới cho 1 vùng như thao tác thường (có undo, đi qua save):
 * - region có ở cả hai → lấy source/translation/flags/confidence của AI; box gắn region lấy text AI, giữ vị trí
 *   và kiểu chữ người đã chỉnh, ngắt dòng lại.
 * - region chỉ có ở AI → thêm region + box AI của nó.
 */
export const applyRegionTranslation = (ai: PageState, regionId: string, layout: Layout) => (s: S) => {
  const next = ai.regions.find((r) => r.id === regionId);
  if (!next) return;
  const cur = regionOf(s, regionId);
  if (!cur) {
    s.regions.push(structuredClone(next));
    for (const b of ai.text_boxes)
      if (b.region_id === regionId && !boxOf(s, b.id)) s.text_boxes.push(structuredClone(b));
    return;
  }
  cur.source_text = next.source_text;
  cur.translation = next.translation;
  cur.confidence = next.confidence;
  cur.flags = [...next.flags];
  const linked = s.text_boxes.filter((b) => b.region_id === regionId);
  if (linked.length === 0) {
    for (const b of ai.text_boxes)
      if (b.region_id === regionId && !boxOf(s, b.id)) s.text_boxes.push(structuredClone(b));
    return;
  }
  for (const b of linked) {
    b.text = next.translation;
    relayout(b, layout);
  }
};

/** Vùng khác nhau giữa state hiện tại và AI mới (cho panel diff). */
export type RegionDiff = {
  id: string;
  kind: "changed" | "added" | "removed";
  current: Region | null;
  ai: Region | null;
};

export function diffRegions(cur: PageState, ai: PageState): RegionDiff[] {
  const out: RegionDiff[] = [];
  const curBy = new Map(cur.regions.map((r) => [r.id, r]));
  const aiBy = new Map(ai.regions.map((r) => [r.id, r]));
  for (const a of ai.regions) {
    const c = curBy.get(a.id);
    if (!c) out.push({ id: a.id, kind: "added", current: null, ai: a });
    else if (c.source_text !== a.source_text || c.translation !== a.translation) {
      out.push({ id: a.id, kind: "changed", current: c, ai: a });
    }
  }
  for (const c of cur.regions) if (!aiBy.has(c.id)) out.push({ id: c.id, kind: "removed", current: c, ai: null });
  return out;
}

/** Thay toàn bộ state bằng kết quả AI (1 bước undo). */
export const resetToAI = (ai: PageState) => (_s: S) => structuredClone(ai) as S;

/**
 * "OCR lại" 1 vùng: lấy chữ gốc + bản dịch mới từ OCR vùng chọn (cùng bbox), giữ id/bbox/kiểu chữ box; box gắn
 * vùng lấy bản dịch mới, ngắt dòng lại.
 */
export const refreshRegionFromOcr = (regionId: string, ocr: Region, layout: Layout) => (s: S) => {
  const r = regionOf(s, regionId);
  if (!r) return;
  r.source_text = nfc(ocr.source_text);
  r.translation = nfc(ocr.translation);
  r.confidence = ocr.confidence;
  r.flags = [...ocr.flags];
  for (const b of s.text_boxes) {
    if (b.region_id !== regionId) continue;
    b.text = r.translation;
    relayout(b, layout);
  }
};

/** Bề rộng viền / cỡ chữ — khớp worker/mtl_pipeline/typeset.py (STROKE_BUBBLE, STROKE_FREE). */
const STROKE_BUBBLE = 0.1;
const STROKE_FREE = 0.12;

/** Viền màu tương phản với chữ, dày theo cỡ chữ (như auto-typeset của worker). */
export function contrastStroke(fill: string, fontSize: number, kind?: Region["kind"]): NonNullable<TextBox["stroke"]> {
  const ratio = kind === "text_free" ? STROKE_FREE : STROKE_BUBBLE;
  return {
    color: fill.toLowerCase() === "#ffffff" ? "#000000" : "#ffffff",
    width: Math.round(Math.max(1.5, fontSize * ratio) * 10) / 10,
  };
}

/** Box mặc định cho vùng/khung mới: chữ đen viền trắng. */
export function newTextBox(id: string, g: Pick<TextBox, "x" | "y" | "w" | "h">, font: string, regionId: string | null) {
  return {
    id,
    region_id: regionId,
    x: g.x,
    y: g.y,
    w: Math.max(8, g.w),
    h: Math.max(8, g.h),
    rotation: 0,
    text: "",
    lines: [],
    font_family: font,
    font_size: 22,
    line_height: LINE_HEIGHT,
    pad: PAD,
    letter_spacing: 0,
    align: "center",
    fill: "#000000",
    stroke: contrastStroke("#000000", 22),
    auto_fit: true,
    hidden: false,
  } satisfies TextBox;
}

/**
 * Chèn kết quả OCR vùng chọn: region (id mới, worker luôn trả "r-user") + box phủ bbox với bản dịch.
 * Màu chữ + viền theo polarity như auto-typeset (chữ sáng trên nền tối → trắng viền đen, ngược lại đen viền trắng).
 */
export const insertOcrRegion =
  (region: Region, ids: { region: string; box: string }, font: string, layout: Layout) => (s: S) => {
    if (regionOf(s, ids.region) || boxOf(s, ids.box)) return;
    const r: Region = {
      ...region,
      id: ids.region,
      source_text: nfc(region.source_text),
      translation: nfc(region.translation),
    };
    s.regions.push(r);
    const [x, y, w, h] = r.bbox;
    const box: TextBox = { ...newTextBox(ids.box, { x, y, w, h }, font, r.id), text: r.translation };
    if (r.polarity === "light_on_dark") box.fill = "#ffffff";
    s.text_boxes.push(box);
    const b = boxOf(s, ids.box) as Draft<TextBox>;
    relayout(b, layout);
    b.stroke = contrastStroke(b.fill, b.font_size, r.kind);
  };
