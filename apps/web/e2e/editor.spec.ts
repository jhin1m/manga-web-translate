/**
 * Màn chương (editor gộp): sửa bản dịch → autosave → reload còn nguyên; rời màn trước debounce vẫn lưu; mất kết
 * nối lưu rồi đóng tab giữa chừng → mở lại đề nghị khôi phục từ IndexedDB → khôi phục → lưu lên server. Thêm:
 * nhiều trang (pager canvas, cột thumbnail ↔ `?page=`) và chính sách khoá (đang dịch không giữ khoá → AI ghi được
 * bản dịch), panel Bản dịch cả chương (click dòng ↔ trang active, sửa tại chỗ, Enter sang dòng sau xuyên trang, cờ
 * tràn khung + lọc "Chỉ khối cần xem"), nút Xem gốc + Chia đôi trong menu ⋯ + giữ O, rail công cụ thu/mở panel,
 * thanh nổi cạnh khối (Sửa chữ, Nhân đôi, Xoá), drawer Hoạt động khi chương đang dịch. Chương tạo qua API + worker giả.
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { type FakeWorkerOptions, PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import {
  apiReadyChapter,
  login,
  openPanel,
  pageThumb,
  pageThumbs,
  railButton,
  state,
  translateIfPrepared,
} from "./helpers.ts";

const headers = { origin: WEB_URL };

type ProgressBody = { chapter: { status: string }; pages: { id: string; status: string }[] };

/** Số chương riêng của spec này (không trùng số cố định của spec khác, VD 501 ở upload-chapter). */
let chapterSeq = 1000;

/** Chương 1 ảnh nguồn đã upload + commit (chưa chạy worker) → id chương. */
async function committedChapter(page: Page) {
  const created = await page.request.post(`/api/chapters`, {
    headers,
    data: {
      series_id: state.seriesId,
      number: String(++chapterSeq),
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  const { chapter, files } = (await created.json()) as {
    chapter: { id: string };
    files: { url: string; fields: Record<string, string> }[];
  };
  const f = files[0];
  if (!f) throw new Error("no upload slot");
  const form = new FormData();
  for (const [k, v] of Object.entries(f.fields)) form.append(k, v);
  form.append("file", new Blob([new Uint8Array(PNG_1PX)], { type: "image/png" }));
  expect((await fetch(f.url, { method: "POST", body: form })).status).toBe(204);
  expect((await page.request.post(`/api/chapters/${chapter.id}/commit`, { headers, data: {} })).status()).toBe(202);
  return chapter.id;
}

const progressOf = async (page: Page, chapterId: string) =>
  (await (await page.request.get(`/api/chapters/${chapterId}/progress`)).json()) as ProgressBody;

/** Chạy worker giả (xong bước 1 thì bấm bước 2 "Dịch") tới khi `done(progress)` đúng → danh sách page. */
async function runUntil(
  page: Page,
  chapterId: string,
  done: (p: ProgressBody) => boolean,
  opts: FakeWorkerOptions = {},
) {
  let stop = false;
  const worker = runFakeWorker(state.token, () => stop, 30_000, opts);
  const deadline = Date.now() + 30_000;
  let p = await progressOf(page, chapterId);
  while (!done(p) && Date.now() < deadline) {
    await translateIfPrepared(page, chapterId, p.chapter.status);
    await page.waitForTimeout(300);
    p = await progressOf(page, chapterId);
  }
  stop = true;
  await worker;
  if (!done(p)) throw new Error(`chapter not ready: ${p.chapter.status}`);
  return p.pages;
}

const allReady = (p: ProgressBody) => p.pages.length > 0 && p.pages.every((x) => x.status === "ready");

/** Chương đã dịch (worker giả) → id chương + page đầu + mọi page. */
async function readyChapter(page: Page, opts: FakeWorkerOptions = {}) {
  const chapterId = await committedChapter(page);
  const pages = await runUntil(page, chapterId, allReady, opts);
  return { chapterId, pageId: pages[0]?.id ?? "", pageIds: pages.map((p) => p.id) };
}

const chapterUrl = (chapterId: string) => `/s/${state.seriesId}/c/${chapterId}`;

/** Ô Dịch của bảng văn bản: trang `ord` (1-based), vùng `i` trong trang. */
const cell = (page: Page, ord = 1, i = 1) => page.getByLabel(`Bản dịch trang ${ord} vùng ${i}`, { exact: true });

/** Mở panel Bản dịch cả chương (rail công cụ). */
async function openTable(page: Page) {
  await openPanel(page, "table");
}

/** Pager góc dưới trái canvas ("Trang n / M"). */
const pager = (page: Page) => page.locator(".cw-pager");

type PageBody = { version: number; state: { regions: { translation: string }[] } };
const translationOf = async (page: Page, pageId: string) =>
  ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as PageBody).state.regions[0]?.translation;

test("edit translation → autosave → reload keeps it; crash mid-edit → restore unsaved changes", async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);

  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await openTable(page);
  await expect(cell(page)).toHaveValue("Xin chào");
  await expect(railButton(page, "text")).toBeEnabled();

  await cell(page).fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(cell(page)).toHaveValue("Chào cậu, ệ ẫ ữ");
  const saved = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
    version: number;
    state_origin: string;
    state: { regions: { translation: string }[] };
  };
  expect(saved.state.regions[0]?.translation).toBe("Chào cậu, ệ ẫ ữ");
  expect(saved.state_origin).toBe("user");

  // So sánh ảnh gốc ↔ bản dịch bằng `\` (đổi layer ảnh, tile cũ không bị vẽ sau khi close).
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  const original = page.getByRole("button", { name: "Xem gốc", exact: true });
  for (const pressed of ["true", "false", "true", "false"]) {
    await page.keyboard.press("\\");
    await expect(original).toHaveAttribute("aria-pressed", pressed);
    await page.waitForTimeout(150);
  }
  // Nút Xem gốc bật/tắt; Chia đôi trong menu ⋯ (mục bật/tắt); đang Chia đôi bấm Xem gốc → Gốc.
  const more = page.getByRole("button", { name: "Thêm thao tác", exact: true });
  const splitItem = page.getByRole("menuitemcheckbox", { name: "Chia đôi gốc / dịch" });
  const toggleSplit = async (on: boolean) => {
    await more.click();
    await expect(splitItem).toHaveAttribute("aria-checked", String(!on));
    await splitItem.click();
    await expect(splitItem).toBeHidden();
    await page.waitForTimeout(150);
  };
  await original.click();
  await expect(original).toHaveAttribute("aria-pressed", "true");
  await original.click();
  await expect(original).toHaveAttribute("aria-pressed", "false");
  await toggleSplit(true);
  await expect(original).toHaveAttribute("aria-pressed", "false");
  await original.click();
  await expect(original).toHaveAttribute("aria-pressed", "true");
  await toggleSplit(true);
  await expect(original).toHaveAttribute("aria-pressed", "false");
  // Esc đóng menu ⋯, focus về nút ⋯.
  await more.click();
  await expect(splitItem).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(splitItem).toBeHidden();
  await expect(more).toBeFocused();
  await toggleSplit(false);
  // Giữ O = tạm xem gốc, nhả = về Dịch.
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.down("o");
  await page.waitForTimeout(150);
  await expect(original).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("o");
  await expect(original).toHaveAttribute("aria-pressed", "false");
  // Chia đôi: sửa ô Dịch vẫn lưu.
  await toggleSplit(true);
  await cell(page).fill("Chia đôi vẫn lưu");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => translationOf(page, pageId)).toBe("Chia đôi vẫn lưu");
  await cell(page).fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await toggleSplit(false);
  expect(pageErrors).toEqual([]);

  // Undo/redo bằng phím tắt.
  await cell(page).fill("Tạm");
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page)).toHaveValue("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });

  // Rời màn chương ngay sau khi sửa (trước debounce 2s) → vẫn lưu trước khi nhả khoá.
  const lockedPuts: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.url().endsWith("/state") && r.status() === 423) lockedPuts.push(1);
  });
  await cell(page).fill("Rời ngay");
  await page.getByRole("link", { name: "Series e2e" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${state.seriesId}$`));
  await expect
    .poll(async () => {
      const r = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as typeof saved;
      return r.state.regions[0]?.translation;
    })
    .toBe("Rời ngay");
  // Lượt lưu cuối tới server trước lệnh nhả khoá (không có PUT nào bị 423).
  expect(lockedPuts).toEqual([]);
  await page.goto(chapterUrl(chapterId));
  await cell(page).fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const beforeCrash = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as typeof saved;

  // "Crash": PUT không tới server, đóng tab khi đang có thay đổi chưa lưu.
  await page.route("**/state", (route) => route.abort());
  await cell(page).fill("Chưa kịp lưu");
  await page.waitForTimeout(800);
  await page.close();

  const again = await context.newPage();
  await again.goto(chapterUrl(chapterId));
  await openTable(again);
  await expect(again.getByText(/thay đổi chưa lưu từ phiên trước ở trang 1/)).toBeVisible();
  await expect(cell(again)).toHaveValue("Chào cậu, ệ ẫ ữ");
  await again.getByRole("button", { name: "Khôi phục" }).click();
  await expect(cell(again)).toHaveValue("Chưa kịp lưu");
  await expect(again.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const after = (await (await again.request.get(`/api/pages/${pageId}`)).json()) as typeof saved;
  expect(after.state.regions[0]?.translation).toBe("Chưa kịp lưu");
  expect(after.version).toBeGreaterThan(beforeCrash.version);
});

test("3 pages shown one at a time: pager and thumbnails stay in sync with ?page= and the select panel", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);
  const { chapterId, pageIds } = await readyChapter(page, { pagesPerSource: 3 });
  expect(pageIds).toHaveLength(3);

  await page.goto(chapterUrl(chapterId));
  const canvas = page.locator(".ed-canvas");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  await openTable(page);
  await expect(cell(page)).toHaveValue("Xin chào");
  await expect(pager(page)).toContainText("Trang 1 / 3");
  await expect(pageThumbs(page).getByText("3 trang", { exact: true })).toBeVisible();

  // Nút ‹ › góc dưới canvas đổi trang: thumbnail, panel Chọn và `?page=` cùng theo.
  const foot = pager(page);
  await expect(foot.getByRole("button", { name: "Trang trước (←)" })).toBeDisabled();
  await foot.getByRole("button", { name: "Trang sau (→)" }).click();
  await expect(foot).toContainText("Trang 2 / 3");
  await foot.getByRole("button", { name: "Trang sau (→)" }).click();
  await expect(foot).toContainText("Trang 3 / 3");
  await expect(foot.getByRole("button", { name: "Trang sau (→)" })).toBeDisabled();
  await expect(pageThumb(page, 3)).toHaveAttribute("aria-current", "page");
  await expect(pageThumb(page, 3)).toHaveAccessibleName("Trang 3 · Xong");
  await expect(page).toHaveURL(new RegExp(`\\?page=${pageIds[2]}$`));
  await expect(await openPanel(page, "select")).toContainText("Trang 3");

  await pageThumb(page, 2).click();
  await expect(foot).toContainText("Trang 2 / 3");
  await expect(pageThumb(page, 2)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("complementary", { name: "Chọn & sửa" })).toContainText("Trang 2");
  await openTable(page);
  await expect(cell(page, 2)).toHaveValue("Xin chào");

  // Sửa trang 2 rồi bấm trang 1 ở cột thumbnail → trang 2 lưu trước khi đổi.
  await cell(page, 2).fill("Trang hai");
  await pageThumb(page, 1).click();
  await expect(foot).toContainText("Trang 1 / 3");
  await expect
    .poll(async () => {
      const r = (await (await page.request.get(`/api/pages/${pageIds[1]}`)).json()) as {
        state: { regions: { translation: string }[] };
      };
      return r.state.regions[0]?.translation;
    })
    .toBe("Trang hai");
  expect(pageErrors).toEqual([]);
});

test("opening a chapter while it translates holds the lock; the busy page is read-only until its AI translation shows up", async ({
  page,
}) => {
  await login(page);
  const chapterId = await committedChapter(page);
  // Chỉ bước 1 (ingest + prepare) rồi bấm bước 2: chương "processing" với job dịch chờ trong hàng.
  await runUntil(page, chapterId, (p) => p.chapter.status === "prepared", {
    capabilities: ["chapter.ingest", "page.prepare"],
  });
  await translateIfPrepared(page, chapterId, "prepared");

  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  const access = page.getByRole("status", { name: "Khoá chương" });
  await expect(access).toContainText("Chỉ xem");
  await expect(access).toContainText("Trang này đang dịch — sửa được khi xong");
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  const detail = async () =>
    (await (await page.request.get(`/api/chapters/${chapterId}`)).json()) as { lock: unknown; status: string };
  // Tab giữ khoá cả lúc chương đang dịch.
  await expect.poll(async () => (await detail()).lock).not.toBeNull();
  expect((await detail()).status).toBe("processing");

  // Drawer Hoạt động liệt kê job dịch chương đang chờ.
  await page.getByRole("button", { name: /^Hoạt động/ }).click();
  const activity = page.getByRole("dialog", { name: "Hoạt động" });
  await expect(activity.locator('[data-job-type="chapter.translate"]')).toContainText("Dịch lô trang", {
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");
  await expect(activity).toBeHidden();

  // AI ghi bản dịch dù chương đang khoá (trang chưa sửa tay) → trang hết bận, hiện bản AI, sửa được.
  const pages = await runUntil(page, chapterId, allReady);
  const pageId = pages[0]?.id ?? "";
  await expect(cell(page)).toHaveValue("Xin chào", { timeout: 15_000 });
  await expect(access).toContainText("Bạn đang giữ khoá chương");
  const st = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
    state_origin: string;
    ai_update_available: boolean;
  };
  expect(st).toMatchObject({ state_origin: "ai", ai_update_available: false });

  await cell(page).fill("Sửa sau khi dịch");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => translationOf(page, pageId)).toBe("Sửa sau khi dịch");
});

test("two tabs on one chapter: the second only reads; closing another tab keeps the lock; the lock moves once freed", async ({
  page,
  context,
}) => {
  await login(page);
  const { chapterId } = await readyChapter(page);
  await page.goto(chapterUrl(chapterId));
  const editA = page.getByRole("status", { name: "Khoá chương" });
  await expect(editA).toContainText("Bạn đang giữ khoá chương");

  // Tab thứ 2 (sessionStorage riêng → tab id khác) của cùng tài khoản: chỉ xem.
  const tabB = await context.newPage();
  await tabB.goto(chapterUrl(chapterId));
  const band = tabB.getByRole("alert", { name: "Cảnh báo chương" });
  await expect(band).toContainText("Chương đang mở ở tab khác — chỉ xem ở tab này.");
  const editB = tabB.getByRole("status", { name: "Khoá chương" });
  await expect(editB).toContainText("Chỉ xem");

  // Tab thứ 3 mở rồi đóng: lệnh nhả khoá của nó (tab id khác) không nhả khoá của tab đang sửa.
  const tabC = await context.newPage();
  await tabC.goto(chapterUrl(chapterId));
  await expect(tabC.getByRole("status", { name: "Khoá chương" })).toContainText("Chỉ xem");
  await tabC.close({ runBeforeUnload: true });
  await band.getByRole("button", { name: "Thử lại" }).click();
  await expect(editB).toContainText("Chỉ xem");
  await expect(editA).toContainText("Bạn đang giữ khoá chương");

  // Tab A rời chương → nhả khoá của chính nó → tab B lấy được khoá.
  await page.goto("/");
  await expect
    .poll(async () => ((await (await tabB.request.get(`/api/chapters/${chapterId}`)).json()) as { lock: unknown }).lock)
    .toBeNull();
  await band.getByRole("button", { name: "Thử lại" }).click();
  await expect(editB).toContainText("Bạn đang giữ khoá chương");
  await expect(band).toHaveCount(0);
  await tabB.close();
});

test("text table: row click activates its page; edit in place autosaves; Enter moves to the next page's row", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);
  const { chapterId, pageIds } = await readyChapter(page, { pagesPerSource: 2 });
  const [p1, p2] = pageIds as [string, string];
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await openTable(page);
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");

  // Click dòng trang 2 → thumbnail + pager trang 2, dòng sáng; panel Chọn "Trang 2 · Khối 1 / 1 · Thoại".
  await page.locator(`[data-row="${p2}:t0"] .cw-src`).click();
  await expect(pageThumb(page, 2)).toHaveAttribute("aria-current", "page");
  await expect(pager(page)).toContainText("Trang 2 / 2");
  await expect(page.locator(`[data-row="${p2}:t0"]`)).toHaveClass(/\bon\b/);
  await expect(await openPanel(page, "select")).toContainText("Trang 2 · Khối 1 / 1 · Thoại");
  await openTable(page);

  // Sửa ô Dịch dòng 1 (trang 1) → lưu. Ô của trang chưa active chỉ đọc tới khi focus kích hoạt xong trang đó.
  await expect(cell(page, 1)).toHaveAttribute("readonly");
  await cell(page, 1).click();
  await cell(page, 1).fill("Trang một mới");
  await expect(pager(page)).toContainText("Trang 1 / 2");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => translationOf(page, p1)).toBe("Trang một mới");

  // Enter ở dòng cuối trang 1 → ô Dịch dòng đầu trang 2; gõ → lưu vào trang 2, không PUT lại trang 1.
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/state")) puts.push(r.url());
  });
  await cell(page, 1).press("Enter");
  await expect(cell(page, 2)).toBeFocused();
  await expect(cell(page, 2)).not.toHaveAttribute("readonly");
  await page.keyboard.type(" nhé");
  await expect(cell(page, 2)).toHaveValue("Xin chào nhé");
  await expect.poll(() => translationOf(page, p2), { timeout: 10_000 }).toBe("Xin chào nhé");
  expect(puts.some((u) => u.includes(p1))).toBe(false);
  expect(await translationOf(page, p1)).toBe("Trang một mới");

  // Shift+Enter → về dòng trước; Esc bỏ focus.
  await cell(page, 2).press("Shift+Enter");
  await expect(cell(page, 1)).toBeFocused();
  await cell(page, 1).press("Escape");
  await expect(cell(page, 1)).not.toBeFocused();
  expect(pageErrors).toEqual([]);
});

test("overflowing box is flagged in the table and thumbnails; 'Chỉ khối cần xem' keeps only that row", async ({
  page,
}) => {
  await login(page);
  const { chapterId, pageIds } = await readyChapter(page, { pagesPerSource: 2 });
  const [p1, p2] = pageIds as [string, string];
  // Box chữ dài trong khung nhỏ gắn vùng t0 của trang 1 (ghi qua API, cần khoá chương).
  const detail = (await (await page.request.get(`/api/pages/${p1}`)).json()) as {
    version: number;
    state: { regions: unknown[]; text_boxes: unknown[] } & Record<string, unknown>;
  };
  const text = "Một câu rất dài không thể vừa khung nhỏ";
  const tiny = {
    id: "tb-tiny",
    region_id: "t0",
    x: 40,
    y: 40,
    w: 40,
    h: 20,
    rotation: 0,
    text,
    lines: [text],
    font_family: "PatrickHand-Regular",
    font_size: 22,
    line_height: 1.15,
    pad: 4,
    letter_spacing: 0,
    align: "center",
    fill: "#000000",
    stroke: null,
    auto_fit: false,
    hidden: false,
  };
  expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/pages/${p1}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: { ...detail.state, text_boxes: [tiny] } },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);

  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  const rows = page.locator(".cw-tbody [data-row]");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(`[data-row="${p1}:t0"]`)).toContainText("Tràn khung");
  await expect(page.locator(`[data-row="${p2}:t0"]`)).toContainText("Xong");
  await expect(pageThumb(page, 1)).toHaveAccessibleName(/^Trang 1 · Cần xem: .*tràn khung/);
  await expect(page.locator(`[data-page="${p1}"] .cw-thumb-mark`)).toHaveText("Cần xem");
  await expect(pageThumb(page, 2)).toHaveAccessibleName("Trang 2 · Xong");

  await page.getByLabel("Chỉ khối cần xem").check();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-row", `${p1}:t0`);

  // Chọn dòng → panel Chọn cảnh báo tràn khung.
  await rows.first().locator(".cw-src").click();
  await expect(await openPanel(page, "select")).toContainText(/Tràn khung \d+px/);
});

test("back/forward straight to another chapter still saves the last edit of the one left", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // Đổi chương = reset store dùng chung: không được cập nhật component của chương cũ giữa lúc render chương mới.
  const renderUpdates: string[] = [];
  page.on("console", (m) => m.text().includes("Cannot update a component") && renderUpdates.push(m.text()));
  await login(page);
  const a = await apiReadyChapter(page, "8101");
  const b = await apiReadyChapter(page, "8102");
  const [aPage] = (await progressOf(page, a)).pages;

  // Lịch sử: B → series → A; `history.go(-2)` từ A về thẳng B (chương → chương, không qua màn khác).
  await page.goto(chapterUrl(b));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await page.getByRole("link", { name: "Series e2e" }).click();
  await page.getByRole("link", { name: "Mở chương 8101", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Chương 8101/ })).toBeVisible();
  await openTable(page);
  await expect(cell(page)).toHaveValue("Xin chào");
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");

  // Sửa rồi đổi chương ngay (trước debounce 2s).
  await cell(page).fill("Đổi chương ngay");
  await page.evaluate(() => history.go(-2));
  await expect(page).toHaveURL(new RegExp(`${chapterUrl(b)}$`));
  await expect(page.getByRole("heading", { name: /^Chương 8102/ })).toBeVisible();
  await expect.poll(() => translationOf(page, aPage?.id ?? ""), { timeout: 10_000 }).toBe("Đổi chương ngay");
  // Chương B mở sạch, không mang sửa của A.
  await openTable(page);
  await expect(cell(page)).toHaveValue("Xin chào");
  expect(pageErrors).toEqual([]);
  expect(renderUpdates).toEqual([]);
});

test("tool rail: clicking the open tool collapses the panel and widens the canvas; clicking again reopens it", async ({
  page,
}) => {
  await login(page);
  const { chapterId } = await readyChapter(page);
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Chọn & sửa" });
  const select = railButton(page, "select");
  await expect(panel).toBeVisible();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  const width = async () => (await page.locator(".ed-canvas").boundingBox())?.width ?? 0;
  const open = await width();

  await select.click();
  await expect(panel).toBeHidden();
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await expect.poll(width).toBeGreaterThan(open + 200);
  // Công cụ vẫn là Chọn khi panel thu; tải lại trang nhớ panel thu.
  await page.reload();
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await expect(panel).toBeHidden();

  await select.click();
  await expect(panel).toBeVisible();
  await expect.poll(width).toBeLessThan(open + 1);
  // Thu bằng nút "Thu panel" (bàn phím) → focus về nút rail của panel vừa thu, không rơi về <body>.
  await panel.getByRole("button", { name: "Thu panel" }).focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  await expect(select).toBeFocused();
  await select.click();
  await expect(panel).toBeVisible();
  // Phím T đổi nội dung panel đang mở sang công cụ Chữ.
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("t");
  await expect(page.getByRole("complementary", { name: "Thêm chữ" })).toBeVisible();
  await page.keyboard.press("v");
  await expect(panel).toBeVisible();

  // Ctrl/Cmd+F → panel Tìm, đoạn "Tìm / Thay", focus ô tìm.
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByRole("complementary", { name: "Tìm / Thay · Glossary" })).toBeVisible();
  await expect(page.locator("#fr-find")).toBeFocused();

  // Vừa khung ↔ 100% (góc dưới phải canvas).
  const zoom = page.locator(".cw-zoom");
  const fit = zoom.getByRole("button", { name: "Vừa khung", exact: true });
  const full = zoom.getByRole("button", { name: "100%", exact: true });
  await expect(fit).toHaveAttribute("aria-pressed", "true");
  await full.click();
  await expect(full).toHaveAttribute("aria-pressed", "true");
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await expect(zoom.locator(".mono")).toHaveText("100%");
  await fit.click();
  await expect(fit).toHaveAttribute("aria-pressed", "true");
});

/** Box chữ gắn vùng t0 (ghi qua API, cần khoá chương). */
async function seedTextBox(page: Page, chapterId: string, pageId: string) {
  const detail = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
    version: number;
    state: { text_boxes: unknown[] } & Record<string, unknown>;
  };
  const tb = {
    id: "tb-one",
    region_id: "t0",
    x: 40,
    y: 120,
    w: 200,
    h: 80,
    rotation: 0,
    text: "Xin chào",
    lines: ["Xin chào"],
    font_family: "PatrickHand-Regular",
    font_size: 22,
    line_height: 1.15,
    pad: 4,
    letter_spacing: 0,
    align: "center",
    fill: "#000000",
    stroke: null,
    auto_fit: false,
    hidden: false,
  };
  expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/pages/${pageId}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: { ...detail.state, text_boxes: [tb] } },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
}

test("floating block toolbar: edit focuses the translation, duplicate adds a free box (undoable), delete removes it", async ({
  page,
}) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await seedTextBox(page, chapterId, pageId);

  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
  const rows = page.locator(".cw-tbody [data-row]");
  await expect(rows).toHaveCount(1);
  const bar = page.getByRole("toolbar", { name: "Thao tác khối" });
  await expect(bar).toHaveCount(0);

  // Chọn khối (dòng bảng) → thanh nổi hiện; "Sửa chữ" mở panel Chọn + focus ô Bản dịch.
  await rows.first().locator(".cw-src").click();
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Sửa chữ" }).click();
  await expect(page.getByRole("complementary", { name: "Chọn & sửa" })).toBeVisible();
  await expect(page.locator("#cw-translation")).toBeFocused();

  // Nhân đôi → thêm 1 dòng "Tự thêm"; Ctrl+Z bỏ.
  await bar.getByRole("button", { name: "Nhân đôi khối" }).click();
  await openTable(page);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.cw-tbody [data-row][title*="Tự thêm"]')).toHaveCount(1);
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows).toHaveCount(1);

  // Xoá khối → khung mất (dòng vùng OCR còn, không còn box), lưu lên server.
  await rows.first().locator(".cw-src").click();
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Xoá khối" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
            state: { text_boxes: unknown[] };
          }
        ).state.text_boxes.length,
    )
    .toBe(0);
});

test("dragging a block while the panel is collapsed moves it only by the drag distance", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  // Khối lớn giữa trang để bấm trúng giữa khung canvas.
  const detail = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
    version: number;
    state: { text_boxes: unknown[] } & Record<string, unknown>;
  };
  const big = {
    id: "tb-big",
    region_id: "t0",
    x: 60,
    y: 300,
    w: 600,
    h: 400,
    rotation: 0,
    text: "Xin chào",
    lines: ["Xin chào"],
    font_family: "PatrickHand-Regular",
    font_size: 40,
    line_height: 1.15,
    pad: 4,
    letter_spacing: 0,
    align: "center",
    fill: "#000000",
    stroke: null,
    auto_fit: false,
    hidden: false,
  };
  expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/pages/${pageId}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: { ...detail.state, text_boxes: [big] } },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);

  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
  await railButton(page, "select").click();
  await expect(page.getByRole("complementary", { name: "Chọn & sửa" })).toBeHidden();
  await page.waitForTimeout(300);

  const frame = await page.locator(".ed-canvas").boundingBox();
  if (!frame) throw new Error("no canvas");
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 3, cy, { steps: 1 });
  await page.mouse.up();
  // Thả xong panel Chọn mở (khối đã chọn).
  await expect(page.getByRole("complementary", { name: "Chọn & sửa" })).toBeVisible();
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const boxX = async () =>
    (
      (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
        state: { text_boxes: { id: string; x: number; y: number }[] };
      }
    ).state.text_boxes.find((b) => b.id === "tb-big");
  await expect.poll(async () => (await boxX())?.x ?? 0, { timeout: 10_000 }).toBeGreaterThan(60);
  const moved = await boxX();
  // Kéo 30px màn hình ở mức ~100% → lệch ~30px trang; không nhảy theo độ dịch bố cục khi panel mở.
  expect(moved?.x ?? 0).toBeLessThan(60 + 60);
  expect(Math.abs((moved?.y ?? 0) - 300)).toBeLessThan(10);
});

/** Chương 2 trang: trang 1 có 2 khối (src left, same-page center), trang 2 có 1 khối (src center) — áp kiểu từ "src". */
async function seedStyleChapter(page: Page) {
  await login(page);
  const { chapterId, pageIds } = await readyChapter(page, { pagesPerSource: 2 });
  const box = (id: string, align: string, y = 120) => ({
    id,
    region_id: "t0",
    x: 40,
    y,
    w: 200,
    h: 80,
    rotation: 0,
    text: "Xin chào",
    lines: ["Xin chào"],
    font_family: "PatrickHand-Regular",
    font_size: 22,
    line_height: 1.15,
    pad: 4,
    letter_spacing: 0,
    align,
    fill: "#000000",
    stroke: null,
    auto_fit: false,
    hidden: false,
  });
  type Detail = {
    version: number;
    state: { text_boxes: { id: string; align: string; font_size: number }[] } & Record<string, unknown>;
  };
  const detailOf = async (id: string) => (await (await page.request.get(`/api/pages/${id}`)).json()) as Detail;
  // Id box chỉ duy nhất trong trang (AI đặt tb-r1… ở mọi trang): trang 2 có box trùng id với khối nguồn.
  const seeds = [[box("src", "left"), box("same-page", "center", 300)], [box("src", "center")]];
  expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  for (const [i, id] of pageIds.entries()) {
    const d = await detailOf(id);
    const put = await page.request.put(`/api/pages/${id}/state`, {
      headers: { ...headers, "if-match": `"${d.version}"` },
      data: { state: { ...d.state, text_boxes: seeds[i] } },
    });
    expect(put.ok()).toBe(true);
  }
  expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const aligns = async () =>
    (await Promise.all(pageIds.map(detailOf))).flatMap((d) =>
      d.state.text_boxes.map((b) => `${b.id}:${b.align}:${b.font_size}`),
    );

  return { chapterId, pageIds, aligns };
}

/** Mở bảng, chọn khối "src" trang 1, đổi cỡ chữ 18 rồi bấm "Áp kiểu này cho khối…" → trả toast hoàn tác. */
async function applyStyleFromFirstBlock(page: Page, chapterId: string) {
  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
  await page.locator(".cw-tbody [data-row]").first().locator(".cw-src").click();
  const panel = await openPanel(page, "select");
  // Gõ từng phím "18" đè cỡ 22: phím "1" (< min 6) không được kẹp ngay thành 6 rồi ghép "8" thành 68.
  const size = panel.getByLabel("Cỡ chữ (px)");
  await size.selectText();
  await size.pressSequentially("18");
  await size.press("Enter");
  await expect(size).toHaveValue("18");
  await panel.getByText("Kiểu chữ nâng cao").click();
  await panel.getByRole("button", { name: /Áp kiểu này cho khối/ }).click();
  const toast = page.locator(".cw-toasts .notice", { hasText: "Đã áp kiểu cho 2 khối" });
  await expect(toast).toContainText("trên 2 trang");
  // Trang đang mở nạp bản mới nhưng vẫn giữ khối đang chọn (panel Chọn không nhảy về trang).
  await expect(panel.getByRole("button", { name: /Áp kiểu này cho khối/ })).toBeVisible();

  return { toast, panel };
}

test("apply style to same-kind blocks writes every page in one batch; the toast's Hoàn tác restores all pages", async ({
  page,
}) => {
  const { chapterId, aligns } = await seedStyleChapter(page);
  const { toast } = await applyStyleFromFirstBlock(page, chapterId);
  expect(await aligns()).toEqual(["src:left:18", "same-page:left:18", "src:left:18"]);

  // Thông báo khác xuất hiện sau đó (ẩn trang) không được đè mất toast hoàn tác của lượt trước.
  await pageThumb(page, 2).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ẩn trang 2" }).click();
  await expect(page.locator(".cw-toasts .notice", { hasText: "Đã ẩn trang 2" })).toBeVisible();
  await expect(toast).toBeVisible();

  // 1 lượt cả chương → 1 lần hoàn tác khôi phục mọi trang (kể cả trang đang mở). Bấm đúp: lần 2 không được chạy lại
  // hoàn tác rồi báo sai "Không hoàn tác được" đè thông báo thành công.
  await toast.getByRole("button", { name: "Hoàn tác" }).dblclick();
  const done = page.locator(".cw-toasts .notice", { hasText: "Đã hoàn tác áp kiểu trên 2 trang" });
  await expect(done).toBeVisible();
  expect(await aligns()).toEqual(["src:left:18", "same-page:center:22", "src:center:22"]);
  await expect(done).toBeVisible();
  await expect(page.locator(".cw-toasts .notice", { hasText: "Không hoàn tác được" })).toHaveCount(0);
});

test("apply style then edit one page: Hoàn tác restores the other pages and names the skipped page", async ({
  page,
}) => {
  const { chapterId, aligns } = await seedStyleChapter(page);
  const { toast, panel } = await applyStyleFromFirstBlock(page, chapterId);
  expect(await aligns()).toEqual(["src:left:18", "same-page:left:18", "src:left:18"]);

  // Sửa tiếp trang đang mở (trang 1) sau khi áp → trang 1 bị bỏ qua, trang 2 vẫn khôi phục.
  const size = panel.getByLabel("Cỡ chữ (px)");
  await size.selectText();
  await size.pressSequentially("20");
  await size.press("Enter");
  await expect(size).toHaveValue("20");
  await expect.poll(async () => (await aligns())[0]).toBe("src:left:20");

  await toast.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(
    page.locator(".cw-toasts .notice", {
      hasText: "Đã hoàn tác áp kiểu trên 1 trang · trang đang mở (trang 1) giữ nguyên vì đã sửa sau đó",
    }),
  ).toBeVisible();
  expect(await aligns()).toEqual(["src:left:20", "same-page:left:18", "src:center:22"]);
  // Trang đang mở nạp lại đúng bản đã giữ, không mất khối đang chọn.
  await expect(size).toHaveValue("20");
});

test("cancelling a block's re-OCR while its job is still queued restores the button and cancels the job on the server", async ({
  page,
}) => {
  await login(page);
  // Worker giả đã dừng và không nhận page.ocr_region → job OCR nằm queued mãi.
  const { chapterId, pageId } = await readyChapter(page);
  await seedTextBox(page, chapterId, pageId);
  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  const rows = page.locator(".cw-tbody [data-row]");
  await expect(rows).toHaveCount(1);
  await rows.first().locator(".cw-src").click();

  const panel = await openPanel(page, "select");
  const started = page.waitForResponse((r) => r.url().includes("/ocr-region") && r.request().method() === "POST");
  await panel.getByRole("button", { name: "Dịch lại khối" }).click();
  const jobId = ((await (await started).json()) as { job: { id: string } }).job.id;

  await expect(panel.getByRole("button", { name: "Đang OCR…" })).toBeVisible();
  await panel.getByRole("button", { name: "Huỷ OCR" }).click();

  await expect(panel.getByRole("button", { name: "Dịch lại khối" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Huỷ OCR" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () => ((await (await page.request.get(`/api/jobs/${jobId}`)).json()) as { status: string }).status)
    .toBe("cancelled");
});

test("leaving the chapter while a block's re-OCR is queued cancels the job on the server", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await seedTextBox(page, chapterId, pageId);
  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  await page.locator(".cw-tbody [data-row]").first().locator(".cw-src").click();

  const panel = await openPanel(page, "select");
  const started = page.waitForResponse((r) => r.url().includes("/ocr-region") && r.request().method() === "POST");
  await panel.getByRole("button", { name: "Dịch lại khối" }).click();
  const jobId = ((await (await started).json()) as { job: { id: string } }).job.id;
  await expect(panel.getByRole("button", { name: "Đang OCR…" })).toBeVisible();

  // Rời editor trong app (không tải lại trang) → kết quả bị bỏ, job trên server cũng phải dừng.
  await page.locator(".cw-back").click();
  await expect(page).not.toHaveURL(new RegExp(`/c/${chapterId}`));
  await expect
    .poll(async () => ((await (await page.request.get(`/api/jobs/${jobId}`)).json()) as { status: string }).status)
    .toBe("cancelled");
});
