/**
 * Gate parity Konva ↔ render.py: vẽ từng dòng của các page_state golden (mọi font trong manifest trừ font loại ở scripts/typeset-parity.ts) bằng CHÍNH `drawBoxText` + `loadFonts` của
 * editor (nạp qua Vite dev) trên Konva canvas pixelRatio 1, đo bbox pixel alpha ≥ 128 và so từng cạnh với bbox
 * mực do render.py đo (fixtures/typeset-parity.json, sinh bởi scripts/typeset-parity.ts). Ngưỡng ≤ 1px mọi dòng.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

const TOLERANCE_PX = 1;
type BBox = [number, number, number, number] | null;
type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  font_size: number;
  line_height: number;
  pad: number;
  valign?: "top" | "middle";
  font_family: string;
  [k: string]: unknown;
};
type Fixture = {
  pages: {
    id: string;
    state: { text_boxes: Box[] };
    expected: {
      id: string;
      lines: { x: number; baseline: number; advance: number }[];
      ink: BBox[];
      /** Box thiếu lines: kết quả ngắt dòng của render.ensure_lines. */
      wrapped?: { lines: string[]; font_size: number };
    }[];
  }[];
};

// Konva UMD (window.Konva) chỉ để dựng Stage/Shape/Context; chữ vẽ bởi drawBoxText của editor.
const KONVA_UMD = join(dirname(createRequire(import.meta.url).resolve("konva")), "..", "konva.min.js");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/typeset-parity.json", import.meta.url), "utf8")) as Fixture;

test("Konva (drawBoxText của editor) khớp render.py ≤ 1px bbox mực từng dòng", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.addScriptTag({ path: KONVA_UMD });

  // Lần import đầu có thể làm Vite tối ưu thêm dependency (react-konva…) và reload trang (mất window.Konva) → thử lại.
  const run = () =>
    page.evaluate(async (pages) => {
      const [node, fonts, measure] = await Promise.all([
        import(/* @vite-ignore */ "/src/features/editor/canvas/TextBoxNode.tsx"),
        import(/* @vite-ignore */ "/src/features/editor/fonts.ts"),
        import(/* @vite-ignore */ "/src/features/editor/measure.ts"),
      ]);
      // @ts-expect-error Konva nạp qua script tag
      const Konva = window.Konva;
      Konva.pixelRatio = 1;
      const kit = await fonts.loadFonts();
      const host = document.createElement("div");
      document.body.append(host);

      const rows: unknown[] = [];
      for (const pg of pages) {
        for (const raw of pg.state.text_boxes) {
          // Box thiếu lines (sau find/replace): ngắt bằng layout của editor như drawBoxText khi hiển thị.
          const wrapped =
            raw.lines.length === 0 && String(raw.text).trim() !== ""
              ? (kit.layout(raw as never) as { lines: string[]; font_size: number })
              : null;
          const box = wrapped ? { ...raw, ...wrapped } : raw;
          const m = kit.metrics(box.font_family);
          const asc = (m.ascent * box.font_size) / m.unitsPerEm;
          // Baseline cả khối do editor tính (gồm valign middle, hợp đồng mục 3); từng dòng vẽ riêng nên dịch y để
          // baseline kiểu "top" của dòng đó trùng baseline này.
          const placed = measure.linePlacements(box, m, kit.measure);
          const sw = box.stroke && box.stroke.width > 0 ? box.stroke.width : 0;
          // Cùng khung cắt với line_ink_bboxes của render.py.
          const margin = Math.trunc(box.font_size * 2 + sw) + 4;
          const ox = Math.trunc(box.x) - margin;
          const oy = Math.trunc(box.y) - margin;
          const W = Math.ceil(box.w) + 2 * margin;
          const H = Math.ceil(box.h) + 2 * margin;
          const bboxes = box.lines.map((line: string, i: number) => {
            // Mỗi dòng vẽ riêng: dịch y để baseline dòng i về dòng 0 (cùng baseline như khi vẽ cả box).
            const single = {
              ...box,
              lines: [line],
              valign: "top",
              y: box.y + (placed[i]?.baseline ?? 0) - box.pad - asc,
            };
            const stage = new Konva.Stage({ container: host, width: W, height: H });
            const layer = new Konva.Layer();
            layer.add(
              new Konva.Shape({
                // biome-ignore lint/suspicious/noExplicitAny: Konva.Context từ bản UMD, không có type
                sceneFunc: (ctx: any) => {
                  ctx.translate(single.x - ox, single.y - oy);
                  node.drawBoxText(ctx, single, kit);
                },
              }),
            );
            stage.add(layer);
            const px = layer.getCanvas()._canvas.getContext("2d").getImageData(0, 0, W, H).data;
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -1;
            let y1 = -1;
            for (let yy = 0; yy < H; yy++)
              for (let xx = 0; xx < W; xx++)
                if (px[(yy * W + xx) * 4 + 3] >= 128) {
                  x0 = Math.min(x0, xx);
                  y0 = Math.min(y0, yy);
                  x1 = Math.max(x1, xx);
                  y1 = Math.max(y1, yy);
                }
            stage.destroy();
            return x1 < 0 ? null : [x0 + ox, y0 + oy, x1 + 1 + ox, y1 + 1 + oy];
          });
          rows.push({ page: pg.id, box: box.id, bboxes, wrapped });
        }
      }
      host.remove();
      return rows as {
        page: string;
        box: string;
        bboxes: BBox[];
        wrapped: { lines: string[]; font_size: number } | null;
      }[];
    }, fixture.pages);

  let rows: Awaited<ReturnType<typeof run>> | undefined;
  for (let attempt = 0; attempt < 4 && !rows; attempt++) {
    try {
      rows = await run();
    } catch (e) {
      if (attempt === 3) throw e;
      await page.waitForLoadState("load");
      await page.waitForTimeout(1500);
      await page.addScriptTag({ path: KONVA_UMD });
    }
  }
  if (!rows) throw new Error("không đo được");

  const report = rows.flatMap((r) => {
    const pg = fixture.pages.find((p) => p.id === r.page);
    const exp = pg?.expected.find((e) => e.id === r.box);
    const box = pg?.state.text_boxes.find((b) => b.id === r.box);
    return r.bboxes.map((k, li) => {
      const p = exp?.ink[li] ?? null;
      const diff = p && k ? Math.max(...p.map((v, j) => Math.abs(v - (k[j] as number)))) : Number.POSITIVE_INFINITY;
      return {
        page: r.page,
        box: r.box,
        line: li,
        font: box?.font_family,
        size: box?.font_size,
        pillow: p,
        konva: k,
        diff,
      };
    });
  });
  // Ngắt dòng editor (canvas) phải trùng render.ensure_lines (Pillow) — từng dòng + cỡ chữ auto-fit.
  const wraps = rows.filter((r) => r.wrapped);
  for (const r of wraps) {
    const exp = fixture.pages.find((p) => p.id === r.page)?.expected.find((e) => e.id === r.box);
    expect(r.wrapped, `${r.page}/${r.box}`).toEqual(exp?.wrapped);
  }
  expect(wraps.length).toBeGreaterThanOrEqual(8);
  const max = Math.max(...report.map((r) => r.diff));
  const bad = report.filter((r) => r.diff > TOLERANCE_PX);
  const exact = report.filter((r) => r.diff === 0).length;
  console.log(
    `parity: ${report.length} dòng, khớp tuyệt đối ${exact}, lệch tối đa ${max}px, vượt ngưỡng ${bad.length}`,
  );
  expect(report.length).toBeGreaterThanOrEqual(40);
  // Gate phải phủ cả căn giữa dọc có dư chỗ (dy > 0) lẫn box tràn (dy kẹp 0).
  const middles = fixture.pages.flatMap((p) => p.state.text_boxes).filter((b) => b.valign === "middle");
  expect(middles.length).toBeGreaterThanOrEqual(10);
  expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
});
