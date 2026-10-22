/**
 * Đo và đặt dòng chữ theo hợp đồng layout (docs/typeset-layout-contract.md) — thuần TS, không DOM:
 * hàm đo advance (`MeasureFn`) và metric font được tiêm vào (browser: canvas `measureText` + manifest font).
 *
 * Ngắt dòng/khớp cỡ chữ cùng thuật toán với `worker/mtl_pipeline/typeset.py` (wrap greedy theo từ, binary search
 * cỡ nguyên MIN..MAX, không vừa → MIN + cắt cứng theo ký tự). Khác biệt duy nhất: editor tôn trọng xuống dòng
 * người gõ (`\n` = đoạn mới); text AI không có `\n` nên kết quả trùng server.
 */
import type { TextBox } from "@mtl/shared";

export const MIN_SIZE = 10;
export const MAX_SIZE = 64;
export const LINE_HEIGHT = 1.15;
export const PAD = 4;

/** Metric lấy từ bảng font (manifest worker/fonts), đơn vị font. */
export type FontMetrics = { unitsPerEm: number; ascent: number; descent: number };
/** Advance (px) của `text` ở cỡ `size` với font `fontId`. */
export type MeasureFn = (text: string, fontId: string, size: number) => number;
export type LinePlacement = { text: string; x: number; baseline: number; advance: number };

export const nfc = (s: string) => s.normalize("NFC");

export const ascentPx = (m: FontMetrics, size: number) => (m.ascent * size) / m.unitsPerEm;
export const descentPx = (m: FontMetrics, size: number) => (m.descent * size) / m.unitsPerEm;
export const lineStep = (m: FontMetrics, size: number, lineHeight: number) =>
  (ascentPx(m, size) + descentPx(m, size)) * lineHeight;

/** Chiều cao khối n dòng (không gồm pad) — như `block_height` của typeset.py. */
export function blockHeight(m: FontMetrics, size: number, n: number, lineHeight = LINE_HEIGHT): number {
  const one = ascentPx(m, size) + descentPx(m, size);
  return one + Math.max(0, n - 1) * one * lineHeight;
}

/** Wrap greedy theo từ trong 1 đoạn; từ đơn dài hơn maxW → null (cỡ này không vừa). */
function wrapParagraph(text: string, fontId: string, size: number, maxW: number, measure: MeasureFn) {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (measure(word, fontId, size) > maxW) return null;
    const cand = cur ? `${cur} ${word}` : word;
    if (measure(cand, fontId, size) <= maxW) cur = cand;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Wrap theo từ, từng đoạn (`\n`); null khi có từ không vừa. */
export function wrapWords(text: string, fontId: string, size: number, maxW: number, measure: MeasureFn) {
  const out: string[] = [];
  for (const para of nfc(text).split("\n")) {
    const lines = wrapParagraph(para, fontId, size, maxW, measure);
    if (lines === null) return null;
    out.push(...lines);
  }
  return out;
}

/** Cắt cứng theo ký tự (từ quá dài ở cỡ nhỏ nhất). */
export function hardWrap(text: string, fontId: string, size: number, maxW: number, measure: MeasureFn): string[] {
  const lines: string[] = [];
  for (const para of nfc(text).split("\n")) {
    let cur = "";
    for (const ch of para) {
      if (cur && measure(cur + ch, fontId, size) > maxW) {
        lines.push(cur.trimEnd());
        cur = ch.trimStart();
      } else cur += ch;
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/** Cỡ chữ nguyên lớn nhất để text vừa (w, h) — như `fit_text` của typeset.py. */
export function fitText(
  text: string,
  fontId: string,
  w: number,
  h: number,
  pad: number,
  lineHeight: number,
  m: FontMetrics,
  measure: MeasureFn,
): { size: number; lines: string[] } {
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  let lo = MIN_SIZE;
  let hi = MAX_SIZE;
  let best: { size: number; lines: string[] } | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const lines = wrapWords(text, fontId, mid, innerW, measure);
    if (lines !== null && blockHeight(m, mid, lines.length, lineHeight) <= innerH) {
      best = { size: mid, lines };
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best ?? { size: MIN_SIZE, lines: hardWrap(text, fontId, MIN_SIZE, innerW, measure) };
}

type LayoutInput = Pick<TextBox, "text" | "font_family" | "font_size" | "line_height" | "pad" | "w" | "h" | "auto_fit">;

/**
 * Chốt `lines[]` (+ cỡ chữ khi auto_fit) cho box. Không auto_fit: giữ cỡ, wrap theo bề rộng box (từ quá dài →
 * cắt cứng) — box có thể tràn chiều cao, người sửa tự kéo.
 */
export function layoutBox(
  box: LayoutInput,
  m: FontMetrics,
  measure: MeasureFn,
): { lines: string[]; font_size: number } {
  const text = nfc(box.text);
  if (!text.trim()) return { lines: [], font_size: box.font_size };
  if (box.auto_fit) {
    const r = fitText(text, box.font_family, box.w, box.h, box.pad, box.line_height, m, measure);
    return { lines: r.lines, font_size: r.size };
  }
  const innerW = box.w - 2 * box.pad;
  const lines =
    wrapWords(text, box.font_family, box.font_size, innerW, measure) ??
    hardWrap(text, box.font_family, box.font_size, innerW, measure);
  return { lines, font_size: box.font_size };
}

/**
 * Pen origin + baseline từng dòng trong toạ độ của box (gốc = góc trái-trên box, chưa xoay) — quy tắc 3–4.
 * Cộng (box.x, box.y) để ra toạ độ page như render.py.
 */
export function linePlacements(
  box: Pick<TextBox, "lines" | "font_family" | "font_size" | "line_height" | "pad" | "w" | "align">,
  m: FontMetrics,
  measure: MeasureFn,
): LinePlacement[] {
  const asc = ascentPx(m, box.font_size);
  const step = lineStep(m, box.font_size, box.line_height);
  const innerW = box.w - 2 * box.pad;
  return box.lines.map((raw, i) => {
    const text = nfc(raw);
    const advance = measure(text, box.font_family, box.font_size);
    let x = box.pad;
    if (box.align === "center") x += (innerW - advance) / 2;
    else if (box.align === "right") x += innerW - advance;
    return { text, x, baseline: box.pad + asc + i * step, advance };
  });
}

type OverflowBox = Pick<TextBox, "lines" | "font_family" | "font_size" | "line_height" | "pad" | "w" | "h">;

/** Số px chữ tràn theo từng trục (âm/0 = vừa). */
function overflowAxes(box: OverflowBox, m: FontMetrics, measure: MeasureFn) {
  const tall = blockHeight(m, box.font_size, box.lines.length, box.line_height) + 2 * box.pad - box.h;
  const innerW = box.w - 2 * box.pad;
  let wide = 0;
  for (const l of box.lines) wide = Math.max(wide, measure(nfc(l), box.font_family, box.font_size) - innerW);
  return { tall, wide };
}

/**
 * Dung sai tràn khung: tràn ≤ max(2px, 4% cạnh box theo trục tràn) coi như vừa. Box auto_fit do render.py
 * (Pillow) chọn cỡ và lưu kích thước đã làm tròn; đo lại ở trình duyệt lệch vài phần nghìn px tới ~1px, mắt
 * không thấy — không được tính là "cần xem".
 */
export const OVERFLOW_TOLERANCE_PX = 2;
export const OVERFLOW_TOLERANCE_RATIO = 0.04;
const overflowTolerance = (side: number) => Math.max(OVERFLOW_TOLERANCE_PX, OVERFLOW_TOLERANCE_RATIO * side);

/**
 * Số px chữ tràn khỏi box cần cảnh báo (0 = vừa hoặc tràn trong dung sai): chiều cao khối dòng + 2·pad vượt `h`,
 * hoặc dòng rộng hơn `w − 2·pad`. Đo trên `lines` đã chốt (như khi vẽ), cùng công thức chiều cao với `fitText` —
 * box auto_fit chỉ tràn khi đã xuống cỡ nhỏ nhất mà vẫn không vừa. Vượt dung sai → trả số px đo thật (không trừ
 * dung sai). Nguồn duy nhất cho cờ "tràn khung" (bảng văn bản, cột trang, panel Chọn, cảnh báo xuất).
 */
export function boxOverflow(box: OverflowBox, m: FontMetrics, measure: MeasureFn): number {
  if (box.lines.length === 0) return 0;
  const { tall, wide } = overflowAxes(box, m, measure);
  return Math.max(tall > overflowTolerance(box.h) ? tall : 0, wide > overflowTolerance(box.w) ? wide : 0);
}

export const boxOverflows = (box: OverflowBox, m: FontMetrics, measure: MeasureFn) => boxOverflow(box, m, measure) > 0;
