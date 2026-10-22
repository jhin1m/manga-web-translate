/**
 * Dòng của bảng văn bản toàn chương (thuần, test không DOM): 1 dòng / region chữ + 1 dòng / text box không gắn
 * region chữ, theo `ord` page rồi thứ tự trong state. Region `bubble` (khung bóng thoại detector trả, không chứa
 * chữ — worker không OCR/dịch) không thành dòng: vẫn nằm trong state cho typeset, chỉ ẩn khỏi UI văn bản. Page đang sửa lấy từ `editorStore.doc` (bản đang gõ), page khác từ
 * `chapterStore.cache`. Cờ: tràn box, cần soát (`low_conf`), trống, SFX, AI có bản mới (theo page). Region có chữ
 * khớp "Chữ bỏ qua" của series (watermark — không dịch, không box) không thành dòng — trừ khi còn box đang hiện có chữ
 * (chương dịch trước khi thêm mục): giữ dòng để người dùng thấy và xoá chữ đã in.
 */
import { isIgnoredText, type PageState, type Region, type TextBox } from "@mtl/shared";

export type RowFlag = "overflow" | "low_conf" | "empty" | "sfx" | "ai_update";
/** Thoại (trong bóng), chữ nền/dẫn, SFX, khung người tự thêm (không region). */
export type RowKind = "dialog" | "free" | "sfx" | "box";

export type Row = {
  /** `pageId:regionId` hoặc `pageId:boxId`. */
  key: string;
  pageId: string;
  ord: number;
  /** Thứ tự trong page (1-based) — nhãn "vùng i". */
  index: number;
  regionId: string | null;
  /** Box đầu tiên gắn region (null: region chưa có box). */
  boxId: string | null;
  source: string;
  translation: string;
  kind: RowKind;
  flags: RowFlag[];
  /** Vị trí trên page (để cuộn canvas tới): bbox region hoặc khung box. */
  rect: { x: number; y: number; w: number; h: number };
};

export type RowPage = { id: string; ord: number; ai_update_available: boolean };

export const KIND_LABEL: Record<RowKind, string> = { dialog: "Thoại", free: "Chữ nền", sfx: "SFX", box: "Tự thêm" };
export const FLAG_LABEL: Record<RowFlag, string> = {
  overflow: "Tràn khung",
  low_conf: "Cần soát",
  empty: "Trống",
  sfx: "SFX",
  ai_update: "AI có bản mới",
};

export function kindOf(region: Pick<Region, "kind" | "flags"> | undefined): RowKind {
  if (!region) return "box";
  if (region.flags.includes("sfx")) return "sfx";
  return region.kind === "text_free" ? "free" : "dialog";
}

/** Region chứa chữ (có dòng trong bảng) — khác khung bóng thoại `bubble`. */
export const isTextRegion = (r: Pick<Region, "kind">) => r.kind !== "bubble";

/** Khoá dòng của box đang chọn trên canvas. */
export const rowKeyOfBox = (pageId: string, box: Pick<TextBox, "id" | "region_id">, state: PageState) =>
  box.region_id && state.regions.some((r) => r.id === box.region_id && isTextRegion(r))
    ? `${pageId}:${box.region_id}`
    : `${pageId}:${box.id}`;

/** Dòng cần người xem (lọc "Chỉ khối cần xem"); SFX chỉ là nhãn. */
export const needsAttention = (r: Pick<Row, "flags">) => r.flags.some((f) => f !== "sfx");

/** Dòng của 1 page. `overflowOf(box)` = box tràn (đo bằng font đã tải); `ignore` = chữ bỏ qua của series. */
export function pageRows(
  page: RowPage,
  state: PageState | null,
  overflowOf: (b: TextBox) => boolean,
  ignore: readonly string[] = [],
): Row[] {
  if (!state) return [];
  const rows: Row[] = [];
  const ai: RowFlag[] = page.ai_update_available ? ["ai_update"] : [];
  const textRegions = state.regions.filter(isTextRegion);
  // Box gắn region watermark đã ẩn không thành dòng "Tự thêm" (box đó không hiện / không có chữ).
  const regionIds = new Set(textRegions.map((r) => r.id));
  const printed = (r: Region) => state.text_boxes.some((b) => b.region_id === r.id && !b.hidden && b.text.trim());
  const regions = textRegions.filter((r) => printed(r) || !isIgnoredText(r.source_text, ignore));
  for (const r of regions) {
    const linked = state.text_boxes.filter((b) => b.region_id === r.id);
    const flags: RowFlag[] = [];
    if (linked.some((b) => !b.hidden && overflowOf(b))) flags.push("overflow");
    const translated = r.translation.trim().length > 0;
    for (const f of r.flags) {
      // Cờ "empty" của worker = crop không có mực (OCR bỏ qua, worker/mtl_pipeline/ocr.py). Người dùng đã gõ bản
      // dịch cho khối → không còn là khối trống cần xem.
      if (f === "empty" && translated) continue;
      flags.push(f);
    }
    if (!r.flags.includes("empty") && !translated && !r.flags.includes("sfx")) flags.push("empty");
    const [x, y, w, h] = r.bbox;
    rows.push({
      key: `${page.id}:${r.id}`,
      pageId: page.id,
      ord: page.ord,
      index: rows.length + 1,
      regionId: r.id,
      boxId: linked[0]?.id ?? null,
      source: r.source_text,
      translation: r.translation,
      kind: kindOf(r),
      flags: [...flags, ...ai],
      rect: { x, y, w, h },
    });
  }
  for (const b of state.text_boxes) {
    if (b.region_id && regionIds.has(b.region_id)) continue;
    const flags: RowFlag[] = [];
    if (!b.hidden && overflowOf(b)) flags.push("overflow");
    if (!b.text.trim()) flags.push("empty");
    rows.push({
      key: `${page.id}:${b.id}`,
      pageId: page.id,
      ord: page.ord,
      index: rows.length + 1,
      regionId: null,
      boxId: b.id,
      source: "",
      translation: b.text,
      kind: "box",
      flags: [...flags, ...ai],
      rect: { x: b.x, y: b.y, w: b.w, h: b.h },
    });
  }
  return rows;
}

/**
 * Mọi dòng của chương. `active` = page đang sửa + doc hiện tại (ưu tiên hơn cache). `memo` (tuỳ chọn) giữ dòng
 * theo object state — gõ trên page active chỉ tính lại dòng của page đó.
 */
export function buildRows(
  pages: RowPage[],
  cache: Record<string, { state: PageState | null } | undefined>,
  active: { pageId: string | null; doc: PageState | null },
  overflowOf: (b: TextBox) => boolean,
  memo?: WeakMap<PageState, { ord: number; ai: boolean; rows: Row[] }>,
  ignore: readonly string[] = [],
): Row[] {
  const out: Row[] = [];
  for (const p of [...pages].sort((a, b) => a.ord - b.ord)) {
    const state = p.id === active.pageId && active.doc ? active.doc : (cache[p.id]?.state ?? null);
    if (!state) continue;
    const hit = memo?.get(state);
    if (hit && hit.ord === p.ord && hit.ai === p.ai_update_available) {
      out.push(...hit.rows);
      continue;
    }
    const rows = pageRows(p, state, overflowOf, ignore);
    memo?.set(state, { ord: p.ord, ai: p.ai_update_available, rows });
    out.push(...rows);
  }
  return out;
}

export type TableFilter = { review: boolean; page: boolean };

/**
 * Lọc dòng. Dòng `keep` (đang chọn/đang gõ) luôn giữ: gõ vào dòng "Trống"/sửa cho hết tràn làm mất cờ — dòng biến
 * mất giữa lúc gõ thì textarea unmount, phím tiếp theo rơi vào phím tắt canvas.
 */
export function filterRows(rows: Row[], f: TableFilter, activeId: string | null, keep: string | null = null) {
  if (!f.review && !f.page) return rows;
  return rows.filter((r) => r.key === keep || ((!f.review || needsAttention(r)) && (!f.page || r.pageId === activeId)));
}

/**
 * Box cùng loại với khối nguồn để "Áp kiểu cho khối cùng loại": trừ chính box nguồn và box đang ẩn (ẩn khi xuất —
 * không đổi kiểu của khung người dùng đã cất đi).
 */
export function sameKindBoxIds(state: PageState, kind: RowKind, exceptId: string): string[] {
  return state.text_boxes
    .filter(
      (b) =>
        b.id !== exceptId &&
        !b.hidden &&
        kindOf(state.regions.find((r) => r.id === b.region_id && isTextRegion(r))) === kind,
    )
    .map((b) => b.id);
}
