/**
 * Sinh fixture parity Konva ↔ render.py: N page_state golden tất định (nền trơn, không ảnh có bản quyền) +
 * bbox mực từng dòng do render.py đo. Ghi apps/web/e2e/fixtures/typeset-parity.json (commit).
 *   node scripts/typeset-parity.ts           ghi lại fixture
 *   node scripts/typeset-parity.ts --check   sinh lại và báo lệch với fixture đã commit (exit 1)
 * Cần uv + Pillow raqm (xem worker/README). Xoay chưa nằm trong gate nên mọi box rotation = 0.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../apps/web/e2e/fixtures/typeset-parity.json", import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}worker/fonts/manifest.json`, "utf8")) as {
  fonts: Record<string, unknown>;
};
/**
 * Font bị loại khỏi gate vì lệch Konva ↔ render.py quá 1px (kèm số đo). Danh sách này phải khớp mục "Font chưa đạt
 * gate" ở docs/typeset-layout-contract.md; font mới trong manifest tự vào gate, không đạt thì ghi vào đây.
 */
const EXCLUDED_FONTS: Record<string, string> = {};
const FONTS = Object.keys(manifest.fonts)
  .filter((f) => !(f in EXCLUDED_FONTS))
  .sort();

const SAMPLES: string[][] = [
  ["Xin chào!"],
  ["Sao giờ này cậu", "mới tới hả?"],
  ["ếệỗửữẫ", "ẤẬỖỬỮẪ"],
  ["Đường đời", "ngoằn ngoèo"],
  ["KHÔNG ĐƯỢC!!"],
  ["Ừ… để tớ", "nghĩ thêm", "chút đã"],
  ["Quỷ thật, ổn chứ?"],
  ["Rầm!"],
  ["Thằng nhóc đó", "đang ở đâu vậy?", "Mau nói cho tôi!"],
];
/** Box thiếu lines (find/replace, áp glossary xoá lines): cả hai bên tự ngắt — câu dài, bề rộng hẹp dần. */
const WRAP_TEXTS = [
  "Sao giờ này cậu mới tới hả, tụi mình chờ mãi rồi đấy!",
  "Thằng nhóc đó đang ở đâu vậy? Mau nói cho tôi biết ngay!",
  "Ừ… để tớ nghĩ thêm chút đã, đừng hối thế chứ.",
  "KHÔNG ĐƯỢC! Ông Ững bảo phải đợi đến sáng mai.",
  "Đường đời ngoằn ngoèo lắm, cẩn thận kẻo vấp ngã nhé.",
];
const ALIGNS = ["center", "left", "right"] as const;
const STROKES = [0, 1.5, 2, 3.5];
const BOXES_PER_PAGE = 4;
/** Mỗi font ≥ 2 box (cỡ/căn/viền khác nhau); tối thiểu 10 page. */
const PAGES = Math.max(10, Math.ceil((2 * FONTS.length) / BOXES_PER_PAGE));

type Box = ReturnType<typeof plainBox>;

const makeBox = (i: number, slot: number): Box => (i % 5 === 4 ? wrapBox(i, slot) : plainBox(i, slot));

function plainBox(i: number, slot: number) {
  const sample = SAMPLES[i % SAMPLES.length] as string[];
  // Box tràn dọc (valign middle kẹp dy = 0): 1 dòng trong khung thấp hơn khối chữ — tràn < lề cửa sổ đo.
  const overflow = i % 6 === 5;
  const lines = overflow ? sample.slice(0, 1) : sample;
  const size = 18 + ((i * 7) % 30) + (i % 3 === 0 ? 0.5 : 0); // có cỡ lẻ .5
  const sw = STROKES[i % STROKES.length] as number;
  return {
    id: `b${String(i).padStart(2, "0")}`,
    region_id: null as string | null,
    x: 16 + (i % 3) * 7.25,
    y: 20 + slot * 130 + (i % 5) * 3.5,
    w: 380,
    h: overflow ? size * 0.9 : 60 + lines.length * size * 1.4, // còn lại dư chỗ dọc ≥ 60px → dy > 0
    rotation: 0,
    text: lines.join(" ").normalize("NFC"),
    lines: lines.map((l) => l.normalize("NFC")),
    font_family: FONTS[i % FONTS.length] as string,
    font_size: size,
    line_height: [1.0, 1.15, 1.3][i % 3] as number,
    pad: 4 + (i % 3),
    letter_spacing: 0,
    align: ALIGNS[i % 3] as (typeof ALIGNS)[number],
    // Một phần box không có trường (lưu từ trước = top), phần còn lại thử "top" tường minh và "middle".
    // Vòng đầu (mỗi font đúng 1 box/vòng) luôn middle → mỗi font ≥ 1 box căn giữa; vòng sau trộn top / không trường.
    ...(Math.floor(i / FONTS.length) % 2 === 0
      ? { valign: "middle" as const }
      : i % 2 === 1
        ? { valign: "top" as const }
        : {}),
    fill: i % 2 === 0 ? "#111111" : "#fafafa",
    stroke: sw > 0 ? { color: i % 2 ? "#ffffff" : "#1a1a1a", width: sw } : null,
    auto_fit: false,
    hidden: false,
  };
}

/** Box thiếu lines: nửa auto_fit (dò cỡ), nửa giữ cỡ (wrap theo bề rộng). */
function wrapBox(i: number, slot: number): Box {
  const base = plainBox(i, slot); // cùng font + valign với box i: mỗi font đủ box, kể cả box thiếu lines
  const autoFit = i % 10 === 4;
  return {
    ...base,
    id: `b${String(i).padStart(2, "0")}`,
    w: 150 + ((i * 37) % 200),
    h: 120,
    text: (WRAP_TEXTS[i % WRAP_TEXTS.length] as string).normalize("NFC"),
    lines: [],
    font_size: autoFit ? base.font_size : 16 + (i % 4) * 2.5,
    auto_fit: autoFit,
  };
}

function buildPages() {
  const pages = [];
  let n = 0;
  for (let p = 0; p < PAGES; p++) {
    const boxes: Box[] = [];
    for (let s = 0; s < BOXES_PER_PAGE; s++) boxes.push(makeBox(n++, s));
    pages.push({
      id: `golden-${String(p).padStart(2, "0")}`,
      state: {
        schema_version: 1,
        size: { w: 420, h: 20 + BOXES_PER_PAGE * 130 + 120 },
        view: { show_original: false },
        regions: [],
        text_boxes: boxes,
        meta: null,
      },
    });
  }
  return pages;
}

function generate() {
  const pages = buildPages();
  const input = JSON.stringify({ pages: pages.map((p) => ({ id: p.id, boxes: p.state.text_boxes })) });
  const out = execFileSync("uv", ["run", "--project", "worker", "python", "worker/scripts/typeset_parity.py"], {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const measured = (JSON.parse(out) as { pages: { id: string; boxes: unknown[] }[] }).pages;
  return {
    version: 1,
    excluded_fonts: Object.keys(EXCLUDED_FONTS),
    note: "Sinh bởi scripts/typeset-parity.ts — không sửa tay. expected = số đo của worker/mtl_pipeline/render.py.",
    pages: pages.map((p) => ({ ...p, expected: measured.find((m) => m.id === p.id)?.boxes ?? [] })),
  };
}

const data = generate();
const next = `${JSON.stringify(data, null, 1)}\n`;
if (process.argv.includes("--check")) {
  // So theo nội dung (biome có thể định dạng lại file JSON đã commit).
  const a = JSON.stringify(JSON.parse(readFileSync(FIXTURE, "utf8")), null, 1).split("\n");
  const b = next.trimEnd().split("\n");
  const at = a.findIndex((l, i) => l !== b[i]);
  if (at < 0 && a.length === b.length) {
    console.log("typeset-parity: fixture khớp.");
  } else {
    console.error(`typeset-parity: fixture LỆCH với render.py (dòng ${at + 1}). Chạy: node scripts/typeset-parity.ts`);
    console.error(`  commit: ${a[at]}\n  mới:    ${b[at]}`);
    process.exit(1);
  }
} else {
  writeFileSync(FIXTURE, next);
  console.log(`typeset-parity: đã ghi ${FIXTURE}`);
}
