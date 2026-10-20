/**
 * Spike parity: Konva (headless Chromium) vẽ cùng TextBox theo hợp đồng layout, so bbox mực từng dòng với
 * render.py (Pillow+raqm). Gate: lệch ≤ 1px mọi cạnh, mọi dòng, trên 20 box.
 *
 * Konva dùng Shape tuỳ biến (không dùng Konva.Text): baseline tính từ ascent/descent của file font
 * (manifest), x theo advance đo bằng canvas; stroke = lineWidth 2w vẽ trước, fill đè sau
 * (tương đương Konva.Text strokeWidth=2w + fillAfterStrokeEnabled=true).
 */
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TOLERANCE_PX = 1;

type BBox = [number, number, number, number] | null;
interface Rec {
  box: {
    id: string; x: number; y: number; w: number; h: number; font_family: string; font_size: number;
    line_height: number; pad: number; align: "left" | "center" | "right"; fill: string;
    stroke: { color: string; width: number } | null; lines: string[];
  };
  metrics: { unitsPerEm: number; ascent: number; descent: number };
  pillow: { lines: { x: number; baseline: number; advance: number }[]; inkBBoxes: BBox[] };
}

test("Konva khớp render.py ≤ 1px bbox mực từng dòng", async ({ page }) => {
  const data = JSON.parse(readFileSync(join(here, "out", "boxes.json"), "utf8")) as {
    fonts: Record<string, string>; records: Rec[];
  };
  await page.setContent("<!doctype html><html><body><div id='c'></div></body></html>");
  await page.addScriptTag({ path: join(here, "node_modules", "konva", "konva.min.js") });
  const fonts = Object.fromEntries(
    Object.entries(data.fonts).map(([id, p]) => [id, readFileSync(p).toString("base64")]),
  );
  await page.evaluate(async (fonts) => {
    for (const [id, b64] of Object.entries(fonts)) {
      const face = new FontFace(id, `url(data:font/ttf;base64,${b64})`);
      document.fonts.add(await face.load());
    }
  }, fonts);

  const konva = await page.evaluate((records: Rec[]) => {
    // @ts-expect-error Konva nạp qua script tag
    const Konva = window.Konva;
    Konva.pixelRatio = 1;
    const nfc = (s: string) => s.normalize("NFC");
    return records.map(({ box, metrics }) => {
      const asc = (metrics.ascent * box.font_size) / metrics.unitsPerEm;
      const desc = (metrics.descent * box.font_size) / metrics.unitsPerEm;
      const step = (asc + desc) * box.line_height;
      const strokeW = box.stroke && box.stroke.width > 0 ? box.stroke.width : 0;
      // Cùng khung cắt với line_ink_bboxes của render.py.
      const margin = Math.trunc(box.font_size * 2 + strokeW) + 4;
      const ox = Math.trunc(box.x) - margin;
      const oy = Math.trunc(box.y) - margin;
      const W = Math.ceil(box.w) + 2 * margin;
      const H = Math.ceil(box.h) + 2 * margin;
      const font = `${box.font_size}px "${box.font_family}"`;
      const measure = document.createElement("canvas").getContext("2d")!;
      measure.font = font;
      return box.lines.map((raw, i) => {
        const text = nfc(raw);
        const advance = measure.measureText(text).width;
        const innerW = box.w - 2 * box.pad;
        let x = box.x + box.pad;
        if (box.align === "center") x += (innerW - advance) / 2;
        else if (box.align === "right") x += innerW - advance;
        const baseline = box.y + box.pad + asc + i * step;
        const stage = new Konva.Stage({ container: "c", width: W, height: H });
        const layer = new Konva.Layer();
        layer.add(
          new Konva.Shape({
            sceneFunc: (ctx: any) => {
              ctx.setAttr("font", font);
              ctx.setAttr("textBaseline", "alphabetic");
              ctx.setAttr("textAlign", "left");
              if (strokeW > 0) {
                ctx.setAttr("lineWidth", 2 * strokeW);
                ctx.setAttr("lineJoin", "round");
                ctx.setAttr("strokeStyle", box.stroke!.color);
                ctx.strokeText(text, x - ox, baseline - oy);
              }
              ctx.setAttr("fillStyle", box.fill);
              ctx.fillText(text, x - ox, baseline - oy);
            },
          }),
        );
        stage.add(layer);
        const canvas: HTMLCanvasElement = layer.getCanvas()._canvas;
        const px = canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let yy = 0; yy < H; yy++)
          for (let xx = 0; xx < W; xx++)
            if (px[(yy * W + xx) * 4 + 3] >= 128) {
              x0 = Math.min(x0, xx); y0 = Math.min(y0, yy); x1 = Math.max(x1, xx); y1 = Math.max(y1, yy);
            }
        stage.destroy();
        const bbox = x1 < 0 ? null : [x0 + ox, y0 + oy, x1 + 1 + ox, y1 + 1 + oy];
        return { x, baseline, advance, bbox };
      });
    });
  }, data.records);

  const rows = data.records.flatMap((rec, bi) =>
    rec.box.lines.map((_, li) => {
      const p = rec.pillow.inkBBoxes[li];
      const k = konva[bi][li].bbox as BBox;
      const diff = p && k ? Math.max(...p.map((v, j) => Math.abs(v - k[j]))) : Infinity;
      return {
        box: rec.box.id, line: li, font: rec.box.font_family, size: rec.box.font_size,
        stroke: rec.box.stroke?.width ?? 0, pillow: p, konva: k, maxDiffPx: diff,
        advanceDiff: +(konva[bi][li].advance - rec.pillow.lines[li].advance).toFixed(3),
      };
    }),
  );
  writeFileSync(join(here, "out", "parity-report.json"), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.maxDiffPx > TOLERANCE_PX);
  console.log(`dòng: ${rows.length}, lệch tối đa: ${Math.max(...rows.map((r) => r.maxDiffPx))}px, vượt ngưỡng: ${bad.length}`);
  expect(data.records.length).toBe(20);
  expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
});
