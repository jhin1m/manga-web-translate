import { z } from "zod";

/**
 * Hợp đồng layout chữ dùng chung Konva (editor) ↔ Pillow (worker render). Mọi bên vẽ chữ phải tuân:
 * 1. Text chuẩn hoá NFC trước khi đo/vẽ — schema từ chối chuỗi không NFC.
 * 2. Baseline dòng i = box.y + pad + ascent + i·(ascent+descent)·line_height; ascent/descent đọc từ
 *    bảng hhea/OS/2 của file font (manifest font do worker sinh), không dùng metric trình duyệt.
 * 3. stroke.width = bề rộng viền ra NGOÀI glyph. Pillow: stroke_width=w; Konva: strokeWidth=2w + fillAfterStrokeEnabled.
 * 4. Pillow bắt buộc raqm; không fallback basic layout.
 * 5. `lines[]` là kết quả ngắt dòng đã chốt; renderer chỉ vẽ, không ngắt lại (trừ box auto chưa có lines).
 * Tên trường TextBox khớp docs/typeset-layout-contract.md và worker/mtl_pipeline/schema.py.
 */
export const PAGE_STATE_SCHEMA_VERSION = 1;

const isNfc = (s: string) => s === s.normalize("NFC");
/** Chuỗi hiển thị — bắt buộc đã NFC (hợp đồng layout mục 1). */
export const NfcText = z.string().refine(isNfc, { message: "text must be NFC-normalized" });

/** [x, y, w, h] theo pixel của page. */
export const BBox = z.tuple([z.number(), z.number(), z.number().nonnegative(), z.number().nonnegative()]);
export type BBox = z.infer<typeof BBox>;

export const RegionKind = z.enum(["bubble", "text_bubble", "text_free"]);
export const Polarity = z.enum(["dark_on_light", "light_on_dark"]);
export const RegionFlag = z.enum(["sfx", "empty", "low_conf"]);

export const Region = z.object({
  id: z.string().min(1),
  kind: RegionKind,
  bbox: BBox,
  polarity: Polarity,
  source_text: NfcText,
  translation: NfcText,
  confidence: z.number().min(0).max(1),
  flags: z.array(RegionFlag),
});
export type Region = z.infer<typeof Region>;

export const TextAlign = z.enum(["left", "center", "right"]);
const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

export const TextStroke = z.object({
  color: HexColor,
  /** Bề rộng viền ra ngoài glyph (px), xem hợp đồng layout mục 3. */
  width: z.number().nonnegative(),
});

export const TextBox = z.object({
  id: z.string().min(1),
  region_id: z.string().min(1).nullable(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number(),
  text: NfcText,
  /** Dòng đã ngắt (hợp đồng layout mục 5); rỗng khi box auto chưa qua typesetter/editor. */
  lines: z.array(NfcText),
  /** font_id = tên file font không đuôi trong worker/fonts/ (khoá của fonts/manifest.json). */
  font_family: z.string().min(1),
  /** px theo em. */
  font_size: z.number().positive(),
  /** Hệ số nhân bước dòng (docs/typeset-layout-contract.md quy tắc 3). */
  line_height: z.number().positive(),
  /** Lề trong (px), dùng cho baseline và toạ độ x. */
  pad: z.number().nonnegative(),
  letter_spacing: z.number(),
  align: TextAlign,
  fill: HexColor,
  stroke: TextStroke.nullable(),
  auto_fit: z.boolean(),
  hidden: z.boolean(),
});
export type TextBox = z.infer<typeof TextBox>;

export const ContextUsed = z.enum(["rolling", "neighbors", "none"]);

export const PageStateMeta = z.object({
  pipeline_version: z.string(),
  model: z.string(),
  glossary_rev: z.number().int().nonnegative(),
  settings_rev: z.number().int().nonnegative(),
  context_used: ContextUsed,
});

/** Trạng thái một page (editor + export). Không chứa clean_rev — con trỏ ảnh sạch nằm ở cột pages.clean_rev. */
export const PageState = z.object({
  schema_version: z.literal(PAGE_STATE_SCHEMA_VERSION),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  view: z.object({ show_original: z.boolean() }),
  regions: z.array(Region),
  text_boxes: z.array(TextBox),
  meta: PageStateMeta.nullable(),
});
export type PageState = z.infer<typeof PageState>;

/** Kết quả OCR giai đoạn 1 (pages.ocr_result): chỉ chép chữ, chưa dịch. */
export const OcrRegion = Region.omit({ source_text: true, translation: true, confidence: true, flags: true }).extend({
  /** Bóng thoại chứa vùng chữ (chỉ text_bubble) — vùng typeset ở giai đoạn 2. */
  bubble_id: z.string().min(1).nullable(),
});
export type OcrRegion = z.infer<typeof OcrRegion>;
export const OcrItem = z.object({
  id: z.string().min(1),
  source: NfcText,
  is_sfx: z.boolean(),
  empty: z.boolean(),
  confidence: z.number().min(0).max(1),
  /** OCR lệch id sau retry → người sửa phải soát lại. */
  low_conf: z.boolean(),
});
export const OcrResult = z.object({
  regions: z.array(OcrRegion),
  items: z.array(OcrItem),
});
export type OcrResult = z.infer<typeof OcrResult>;

export function emptyPageState(w: number, h: number): PageState {
  return {
    schema_version: PAGE_STATE_SCHEMA_VERSION,
    size: { w, h },
    view: { show_original: false },
    regions: [],
    text_boxes: [],
    meta: null,
  };
}
