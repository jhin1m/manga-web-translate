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

const ws = state.workspaceId;
const headers = { origin: WEB_URL };

type ProgressBody = { chapter: { status: string }; pages: { id: string; status: string }[] };

/** Chương 1 ảnh nguồn đã upload + commit (chưa chạy worker) → id chương. */
async function committedChapter(page: Page) {
  const created = await page.request.post(`/api/w/${ws}/chapters`, {
    headers,
    data: {
      series_id: state.seriesId,
      number: String(100 + Math.floor(Math.random() * 1000)),
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
  expect((await page.request.post(`/api/w/${ws}/chapters/${chapter.id}/commit`, { headers, data: {} })).status()).toBe(
    202,
  );
  return chapter.id;
}

const progressOf = async (page: Page, chapterId: string) =>
  (await (await page.request.get(`/api/w/${ws}/chapters/${chapterId}/progress`)).json()) as ProgressBody;

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

const chapterUrl = (chapterId: string) => `/w/${ws}/s/${state.seriesId}/c/${chapterId}`;

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
  ((await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as PageBody).state.regions[0]?.translation;

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
  const saved = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as {
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
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/s/${state.seriesId}$`));
  await expect
    .poll(async () => {
      const r = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;
      return r.state.regions[0]?.translation;
    })
    .toBe("Rời ngay");
  // Lượt lưu cuối tới server trước lệnh nhả khoá (không có PUT nào bị 423).
  expect(lockedPuts).toEqual([]);
  await page.goto(chapterUrl(chapterId));
  await cell(page).fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const beforeCrash = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;

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
  const after = (await (await again.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;
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
      const r = (await (await page.request.get(`/api/w/${ws}/pages/${pageIds[1]}`)).json()) as {
        state: { regions: { translation: string }[] };
      };
      return r.state.regions[0]?.translation;
    })
    .toBe("Trang hai");
  expect(pageErrors).toEqual([]);
});

test("opening a chapter while it translates does not hold the lock; the AI translation shows up", async ({ page }) => {
  await login(page);
  const chapterId = await committedChapter(page);
  // Chỉ bước 1 (ingest + prepare) rồi bấm bước 2: chương "processing" với job dịch chờ trong hàng.
  await runUntil(page, chapterId, (p) => p.chapter.status === "prepared", {
    capabilities: ["chapter.ingest", "page.prepare"],
  });
  await translateIfPrepared(page, chapterId, "prepared");

  await page.goto(chapterUrl(chapterId));
  await openTable(page);
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Đang dịch — sửa được khi xong");
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await page.waitForTimeout(1500);
  const detail = async () =>
    (await (await page.request.get(`/api/w/${ws}/chapters/${chapterId}`)).json()) as { lock: unknown; status: string };
  expect(await detail()).toMatchObject({ status: "processing", lock: null });

  // Drawer Hoạt động liệt kê job dịch chương đang chờ.
  await page.getByRole("button", { name: /^Hoạt động/ }).click();
  const activity = page.getByRole("dialog", { name: "Hoạt động" });
  await expect(activity.locator('[data-job-type="chapter.translate"]')).toContainText("Dịch chương", {
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");
  await expect(activity).toBeHidden();

  const pages = await runUntil(page, chapterId, allReady);
  await expect(cell(page)).toHaveValue("Xin chào", { timeout: 15_000 });
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
  const st = (await (await page.request.get(`/api/w/${ws}/pages/${pages[0]?.id}`)).json()) as {
    state_origin: string;
    ai_update_available: boolean;
  };
  expect(st).toMatchObject({ state_origin: "ai", ai_update_available: false });
});

test("lock held by someone else → warning band with retry; once the lock is free the band goes away", async ({
  page,
}) => {
  await login(page);
  const { chapterId } = await readyChapter(page);
  // Thành viên khác giữ khoá: server trả 423 cho lần lấy khoá đầu.
  let denied = true;
  await page.route(`**/api/w/${ws}/chapters/${chapterId}/lock`, (route) =>
    denied && route.request().method() === "POST"
      ? route.fulfill({
          status: 423,
          contentType: "application/json",
          body: JSON.stringify({ error: "chapter_locked", holder: "someone", holder_name: "Thành viên B" }),
        })
      : route.fallback(),
  );
  await page.goto(chapterUrl(chapterId));
  const band = page.getByRole("alert", { name: "Cảnh báo chương" });
  await expect(band).toContainText("Thành viên B đang sửa chương này — bạn chỉ xem được.");
  const edit = page.getByRole("status", { name: "Khoá chương" });
  await expect(edit).toContainText("Chỉ xem");

  denied = false;
  await band.getByRole("button", { name: "Thử lại" }).click();
  await expect(edit).toContainText("Bạn đang giữ khoá chương");
  await expect(band).toHaveCount(0);
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
  const detail = (await (await page.request.get(`/api/w/${ws}/pages/${p1}`)).json()) as {
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
  expect((await page.request.post(`/api/w/${ws}/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/w/${ws}/pages/${p1}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: { ...detail.state, text_boxes: [tiny] } },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/w/${ws}/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);

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
  // Phím T đổi nội dung panel đang mở sang công cụ Chữ.
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("t");
  await expect(page.getByRole("complementary", { name: "Thêm chữ" })).toBeVisible();
  await page.keyboard.press("v");
  await expect(panel).toBeVisible();
});

test("floating block toolbar: edit focuses the translation, duplicate adds a free box (undoable), delete removes it", async ({
  page,
}) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  // Box chữ gắn vùng t0 (ghi qua API, cần khoá chương).
  const detail = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as {
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
  expect((await page.request.post(`/api/w/${ws}/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/w/${ws}/pages/${pageId}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: { ...detail.state, text_boxes: [tb] } },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/w/${ws}/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);

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
          (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as {
            state: { text_boxes: unknown[] };
          }
        ).state.text_boxes.length,
    )
    .toBe(0);
});
