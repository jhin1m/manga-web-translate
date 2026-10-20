/** Dữ liệu + hàm đo giả cho test unit editor (không DOM). */
import { emptyPageState, type PageState, type Region, type TextBox } from "@mtl/shared";
import type { Layout } from "../actions.ts";
import { type FontMetrics, layoutBox, type MeasureFn } from "../measure.ts";

/** Font giả: mỗi ký tự rộng 0.5em, ascent 0.8em, descent 0.2em. */
export const METRICS: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: 200 };
export const measure: MeasureFn = (text, _font, size) => [...text].length * size * 0.5;
export const layout: Layout = (box) => layoutBox(box, METRICS, measure);

export function region(id: string, translation = "Xin chào"): Region {
  return {
    id,
    kind: "text_bubble",
    bbox: [10, 10, 100, 50],
    polarity: "dark_on_light",
    source_text: "안녕",
    translation,
    confidence: 0.9,
    flags: [],
  };
}

export function box(id: string, regionId: string | null = null, text = "Xin chào"): TextBox {
  return {
    id,
    region_id: regionId,
    x: 10,
    y: 10,
    w: 200,
    h: 80,
    rotation: 0,
    text,
    lines: [text],
    font_family: "F",
    font_size: 20,
    line_height: 1.15,
    pad: 4,
    letter_spacing: 0,
    align: "center",
    fill: "#000000",
    stroke: null,
    auto_fit: false,
    hidden: false,
  };
}

export function doc(n = 2): PageState {
  return {
    ...emptyPageState(800, 12000),
    regions: Array.from({ length: n }, (_, i) => region(`r${i}`, `Câu ${i}`)),
    text_boxes: Array.from({ length: n }, (_, i) => box(`t${i}`, `r${i}`, `Câu ${i}`)),
  };
}
