/**
 * Editor phải đo/vẽ bằng ĐÚNG file font worker dùng (hợp đồng layout). Chép worker/fonts/{*.ttf,manifest.json}
 * sang apps/web/public/fonts/. `--check`: chỉ so (sha256), lệch → exit 1 (chạy trong `pnpm test`).
 * Chạy: `node scripts/sync-fonts.ts [--check]` (Node ≥ 24, tự bỏ type).
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../../worker/fonts/", import.meta.url));
const dst = fileURLToPath(new URL("../public/fonts/", import.meta.url));
const check = process.argv.includes("--check");

const wanted = (f: string) => f === "manifest.json" || f.endsWith(".ttf") || f.endsWith(".otf");
const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

const files = readdirSync(src).filter(wanted).sort();
const existing = existsSync(dst) ? readdirSync(dst).filter(wanted).sort() : [];
const stale = existing.filter((f) => !files.includes(f));
const differ = files.filter((f) => !existsSync(join(dst, f)) || hash(join(src, f)) !== hash(join(dst, f)));

if (check) {
  if (differ.length || stale.length) {
    console.error(
      `public/fonts lệch worker/fonts: ${[...differ, ...stale].join(", ")} — chạy pnpm --filter @mtl/web fonts:sync`,
    );
    process.exit(1);
  }
  console.info(`public/fonts khớp worker/fonts (${files.length} file)`);
} else {
  mkdirSync(dst, { recursive: true });
  for (const f of differ) copyFileSync(join(src, f), join(dst, f));
  for (const f of stale) rmSync(join(dst, f));
  console.info(`đã đồng bộ ${differ.length} file, xoá ${stale.length} file thừa`);
}
