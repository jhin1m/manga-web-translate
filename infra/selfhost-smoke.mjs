#!/usr/bin/env node
// Kiểm HTTP cho smoke self-host (gọi từ infra/selfhost-smoke.sh). Node 24, chỉ fetch, không phụ thuộc.
//   SMOKE_PAGE_FILE=<ảnh> node infra/selfhost-smoke.mjs run <base-url> <state.json>
//       SPA, upload 1 trang, page.prepare không tốn token + có ảnh xoá chữ, export zip
//   node infra/selfhost-smoke.mjs ocr    <base-url> <state.json> <ocr.json>   # pages.ocr_result (psql) có chữ thật
//   node infra/selfhost-smoke.mjs verify <base-url> <state.json>   # sau down/up: dữ liệu còn, ảnh gốc + export còn
// SMOKE_EXPECT_TEXT (tuỳ chọn): chữ đã vẽ lên trang → OCR phải đọc ra ≥ 50% số ký tự đó.
// Mọi lỗi in method/URL/status/body (cắt 500 ký tự) rồi thoát 1.
import { readFileSync, writeFileSync } from "node:fs";

const [mode, BASE, STATE, OCR_FILE] = process.argv.slice(2);
if (!["run", "verify", "ocr"].includes(mode) || !BASE || !STATE || (mode === "ocr" && !OCR_FILE)) {
  console.error("dùng: selfhost-smoke.mjs run|verify <base-url> <state.json> | ocr <base-url> <state.json> <ocr.json>");
  process.exit(2);
}
/** Số giây dương từ env (rỗng → mặc định); sai định dạng → thoát ngay thay vì chờ mãi / hết giờ tức thì. */
function seconds(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} phải là số giây > 0: '${raw}'`);
    process.exit(2);
  }
  return n;
}
const PREPARE_TIMEOUT_S = seconds("SMOKE_PREPARE_TIMEOUT_S", 900);
const EXPORT_TIMEOUT_S = seconds("SMOKE_EXPORT_TIMEOUT_S", 300);
const DEAD = new Set(["failed", "cancelled"]);

const log = (msg) => console.error(`${new Date().toISOString()} [selfhost-smoke.mjs] ${msg}`);
function die(msg) {
  log(`LỖI: ${msg}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (u) => new URL(u, BASE).toString();

/** fetch + kiểm status; trả Response (body chưa đọc khi `raw`), mặc định JSON đã parse. */
async function call(method, path, { body, form, expect = [200], raw = false, redirect = "follow" } = {}) {
  const url = abs(path);
  const init = { method, redirect, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    die(`${method} ${url} → không kết nối được: ${e.cause?.message ?? e.message}`);
  }
  if (!expect.includes(res.status)) {
    const text = await res.text().catch(() => "");
    die(`${method} ${url} → HTTP ${res.status} (cần ${expect.join("|")}): ${text.slice(0, 500)}`);
  }
  if (raw) return res;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    die(`${method} ${url} → body không phải JSON: ${text.slice(0, 500)}`);
  }
}

function check(cond, msg) {
  if (!cond) die(msg);
}

/** MIME ảnh upload theo magic (chỉ các loại API nhận: png/jpeg/webp). */
function sniffMime(buf) {
  const hex = buf.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return ["image/png", "png"];
  if (hex.startsWith("ffd8ff")) return ["image/jpeg", "jpg"];
  if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return ["image/webp", "webp"];
  return null;
}

async function fetchBytes(url) {
  const res = await call("GET", url, { raw: true });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

// ---- run ----
async function run() {
  // a. SPA + local mode, không đăng nhập
  const root = await call("GET", "/", { raw: true, redirect: "manual" });
  const html = await root.text();
  check(
    (root.headers.get("content-type") ?? "").includes("text/html"),
    `GET / content-type ${root.headers.get("content-type")}`,
  );
  check(html.includes('id="root"'), `GET / không có id="root": ${html.slice(0, 300)}`);
  const cfg = await call("GET", "/api/config");
  check(cfg?.local_mode === true, `/api/config local_mode != true: ${JSON.stringify(cfg)}`);
  const me = await call("GET", "/api/me");
  check(me?.is_admin === true, `/api/me is_admin != true: ${JSON.stringify(me)}`);
  await call("GET", "/api/auth/get-session", { expect: [404], raw: true });
  log("a. SPA 200 + local_mode + /api/me admin không cookie + /api/auth 404");

  // b+c. series (ja → từng trang, OCR local manga_ocr) + chapter + upload + commit dừng ở Bước 1
  const pageFile = process.env.SMOKE_PAGE_FILE;
  check(pageFile, "thiếu SMOKE_PAGE_FILE (ảnh trang để upload)");
  const page = readFileSync(pageFile);
  const mime = sniffMime(page);
  check(mime, `${pageFile} không phải PNG/JPEG/WEBP`);
  const [contentType, ext] = mime;
  const s = await call("POST", "/api/series", {
    body: { title: `Smoke ${Date.now()}`, source_lang: "ja" },
    expect: [201],
  });
  const created = await call("POST", "/api/chapters", {
    body: {
      series_id: s.id,
      number: 1,
      files: [{ name: `001.${ext}`, content_type: contentType, bytes: page.length }],
    },
    expect: [201],
  });
  const chapterId = created.chapter.id;
  for (const f of created.files) {
    check(f.url.startsWith("/files/"), `presign url không tương đối /files/: ${f.url}`);
    const form = new FormData();
    for (const [k, v] of Object.entries(f.fields ?? {})) form.append(k, v);
    form.append("file", new Blob([page], { type: contentType }), `001.${ext}`);
    await call("POST", f.url, { form, expect: [200, 201, 204], raw: true });
  }
  const commit = await call("POST", `/api/chapters/${chapterId}/commit`, {
    body: { target: "prepared" },
    expect: [202],
  });
  check(commit.accepted === 1, `commit accepted != 1: ${JSON.stringify(commit)}`);
  log(`c. upload ${pageFile} (${contentType}, ${page.length} byte) qua /files + commit (job ${commit.job.id})`);

  // d. chờ mọi trang xong page.prepare
  const deadline = Date.now() + PREPARE_TIMEOUT_S * 1000;
  let prog;
  let last = "";
  for (;;) {
    prog = await call("GET", `/api/chapters/${chapterId}/progress`);
    for (const j of [...prog.jobs, ...prog.pages.map((p) => p.job).filter(Boolean)]) {
      if (DEAD.has(j.status)) die(`job ${j.type} ${j.id} ${j.status}: ${JSON.stringify(j.error)}`);
    }
    const failedPage = prog.pages.find((p) => p.status === "failed");
    if (failedPage) die(`trang ${failedPage.id} failed: ${JSON.stringify(failedPage.job)}`);
    const state = `chapter=${prog.chapter.status} pages=${JSON.stringify(prog.counts)}`;
    if (state !== last) log(`d. ${state}`);
    last = state;
    if (
      prog.pages.length > 0 &&
      prog.pages.every((p) => p.status === "prepared" && p.ocr_ready && (!p.job || p.job.status === "succeeded"))
    ) {
      break;
    }
    if (Date.now() > deadline) die(`page.prepare chưa xong sau ${PREPARE_TIMEOUT_S}s: ${state}`);
    await sleep(3000);
  }
  check(prog.chapter.status === "prepared", `chapter status ${prog.chapter.status} (cần prepared)`);
  log(`d. ${prog.pages.length} trang đã page.prepare (OCR + xoá chữ local)`);

  // d2. ảnh đã xoá chữ: có clean_rev, tải được, khác ảnh gốc
  const pg = await call("GET", `/api/chapters/${chapterId}/pages`);
  for (const p of pg.pages) {
    check(p.clean_rev !== null && p.images.clean, `trang ${p.id} chưa có ảnh xoá chữ: ${JSON.stringify(p.images)}`);
    const { buf: clean } = await fetchBytes(p.images.clean);
    const { buf: orig } = await fetchBytes(p.images.original);
    check(clean.length > 0 && !clean.equals(orig), `ảnh xoá chữ trang ${p.id} rỗng hoặc trùng ảnh gốc`);
    log(`d2. trang ${p.ord}: ảnh xoá chữ rev ${p.clean_rev} (${clean.length} byte, khác ảnh gốc ${orig.length} byte)`);
  }

  // e. không tốn token: không có provider AI nào, chi phí hôm nay = 0
  const prov = await call("GET", "/api/admin/providers");
  check(prov.providers.length === 0, `đã có provider AI (${prov.providers.length}) — smoke cần DB trống`);
  const me2 = await call("GET", "/api/me");
  check(me2.quota.spent_usd === 0, `quota.spent_usd = ${me2.quota.spent_usd} (cần 0)`);
  log("e. 0 provider AI, spent_usd = 0");

  // f. export zip → 302 /files → tải được
  const ex = await call("POST", `/api/chapters/${chapterId}/export`, {
    body: { format: "png_zip", layout: "pages", include_untranslated: true },
    expect: [202],
  });
  const exportJobId = ex.job.id;
  const exDeadline = Date.now() + EXPORT_TIMEOUT_S * 1000;
  for (;;) {
    const j = await call("GET", `/api/exports/${exportJobId}`);
    if (j.status === "succeeded") break;
    if (DEAD.has(j.status)) die(`export ${j.status}: ${JSON.stringify(j.error)}`);
    if (Date.now() > exDeadline) die(`export chưa xong sau ${EXPORT_TIMEOUT_S}s: ${j.status} ${j.stage ?? ""}`);
    await sleep(2000);
  }
  const zipBytes = await downloadExport(exportJobId);
  log(`f. export png_zip ${zipBytes} byte, 302 → /files, PK\\x03\\x04`);

  // g. state cho verify
  const pageIds = prog.pages.map((p) => p.id);
  const originalMagic = page.subarray(0, 8).toString("hex");
  writeFileSync(STATE, JSON.stringify({ seriesId: s.id, chapterId, pageIds, exportJobId, originalMagic }, null, 2));
  log(`run OK → ${STATE}`);
}

async function downloadExport(jobId) {
  const r = await call("GET", `/api/exports/${jobId}/download`, { raw: true, redirect: "manual", expect: [302] });
  const loc = r.headers.get("location") ?? "";
  check(loc.startsWith("/files/"), `download Location không bắt đầu /files/: ${loc}`);
  const { res, buf } = await fetchBytes(loc);
  check(
    /attachment/.test(res.headers.get("content-disposition") ?? ""),
    `thiếu attachment: ${res.headers.get("content-disposition")}`,
  );
  check(buf.length > 0, "file export rỗng");
  check(buf.subarray(0, 4).toString("hex") === "504b0304", `không phải zip: ${buf.subarray(0, 4).toString("hex")}`);
  return buf.length;
}

// ---- verify ----
async function verify() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const ch = await call("GET", `/api/chapters/${st.chapterId}`);
  check(ch.status === "prepared", `chapter status sau restart ${ch.status}`);
  const pg = await call("GET", `/api/chapters/${st.chapterId}/pages`);
  const ids = pg.pages.map((p) => p.id);
  check(JSON.stringify(ids) === JSON.stringify(st.pageIds), `trang sau restart ${ids} != ${st.pageIds}`);
  const { buf } = await fetchBytes(pg.pages[0].images.original);
  check(buf.subarray(0, 8).toString("hex") === st.originalMagic, "ảnh gốc tải lại khác định dạng file đã upload");
  const list = await call("GET", `/api/chapters/${st.chapterId}/exports`);
  check(
    list.exports.some((e) => e.id === st.exportJobId && e.status === "succeeded"),
    `export ${st.exportJobId} không còn trong danh sách`,
  );
  const zipBytes = await downloadExport(st.exportJobId);
  log(`verify OK: chương ${ch.status}, ${pg.pages.length} trang, ảnh gốc còn, export ${zipBytes} byte vẫn tải được`);
}

// ---- ocr: pages.ocr_result của chương (API chưa trả OCR trước khi dịch → shell đọc bằng psql) ----
function ocr() {
  const results = JSON.parse(readFileSync(OCR_FILE, "utf8"));
  check(Array.isArray(results) && results.length > 0, `không có ocr_result: ${JSON.stringify(results).slice(0, 300)}`);
  const regions = results.flatMap((r) => r?.regions ?? []);
  const read = results.flatMap((r) => r?.items ?? []).filter((it) => !it.empty && it.source.trim());
  for (const it of read) log(`ocr. ${it.id}: "${it.source}" (conf ${it.confidence}${it.low_conf ? ", low_conf" : ""})`);
  check(
    read.length >= 1,
    `không khối chữ nào có text OCR (${regions.length} vùng): ${JSON.stringify(results).slice(0, 500)}`,
  );
  const want = [...(process.env.SMOKE_EXPECT_TEXT ?? "").replace(/\s+/g, "")];
  if (want.length) {
    const got = new Set(read.map((it) => it.source).join(""));
    const hit = want.filter((ch) => got.has(ch)).length;
    check(hit * 2 >= want.length, `OCR chỉ khớp ${hit}/${want.length} ký tự đã vẽ`);
    log(`ocr. ${read.length} khối có chữ / ${regions.length} vùng, khớp ${hit}/${want.length} ký tự đã vẽ`);
  } else {
    log(`ocr. ${read.length} khối có chữ / ${regions.length} vùng`);
  }
}

if (mode === "ocr") ocr();
else await (mode === "run" ? run() : verify());
