/**
 * Màn chương (editor gộp): sửa bản dịch → autosave → reload còn nguyên; rời màn trước debounce vẫn lưu; mất kết
 * nối lưu rồi đóng tab giữa chừng → mở lại đề nghị khôi phục từ IndexedDB → khôi phục → lưu lên server. Thêm:
 * route editor 1 trang cũ redirect, strip nhiều trang (cuộn → `?page=`, rail → inspector) và chính sách khoá
 * (đang dịch không giữ khoá → AI ghi được bản dịch). Chương tạo qua API + worker giả.
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { type FakeWorkerOptions, PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

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

/** Chạy worker giả tới khi `done(progress)` đúng → danh sách page. */
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
  const cell = page.getByLabel("Bản dịch vùng 1");
  await expect(cell).toHaveValue("Xin chào");
  await expect(page.getByRole("button", { name: /Chữ/ })).toBeEnabled();

  await cell.fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel("Bản dịch vùng 1")).toHaveValue("Chào cậu, ệ ẫ ữ");
  const saved = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as {
    version: number;
    state_origin: string;
    state: { regions: { translation: string }[] };
  };
  expect(saved.state.regions[0]?.translation).toBe("Chào cậu, ệ ẫ ữ");
  expect(saved.state_origin).toBe("user");

  // So sánh ảnh gốc ↔ bản dịch bằng `\` (đổi layer ảnh, tile cũ không bị vẽ sau khi close).
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  const original = page.getByRole("button", { name: "Gốc", exact: true });
  for (const pressed of ["true", "false", "true", "false"]) {
    await page.keyboard.press("\\");
    await expect(original).toHaveAttribute("aria-pressed", pressed);
    await page.waitForTimeout(150);
  }
  expect(pageErrors).toEqual([]);

  // Undo/redo bằng phím tắt.
  await page.getByLabel("Bản dịch vùng 1").fill("Tạm");
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Bản dịch vùng 1")).toHaveValue("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });

  // Rời màn chương ngay sau khi sửa (trước debounce 2s) → vẫn lưu trước khi nhả khoá.
  const lockedPuts: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.url().endsWith("/state") && r.status() === 423) lockedPuts.push(1);
  });
  await page.getByLabel("Bản dịch vùng 1").fill("Rời ngay");
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
  await page.getByLabel("Bản dịch vùng 1").fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const beforeCrash = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;

  // "Crash": PUT không tới server, đóng tab khi đang có thay đổi chưa lưu.
  await page.route("**/state", (route) => route.abort());
  await page.getByLabel("Bản dịch vùng 1").fill("Chưa kịp lưu");
  await page.waitForTimeout(800);
  await page.close();

  const again = await context.newPage();
  await again.goto(chapterUrl(chapterId));
  await expect(again.getByText(/thay đổi chưa lưu từ phiên trước ở trang 1/)).toBeVisible();
  await expect(again.getByLabel("Bản dịch vùng 1")).toHaveValue("Chào cậu, ệ ẫ ữ");
  await again.getByRole("button", { name: "Khôi phục" }).click();
  await expect(again.getByLabel("Bản dịch vùng 1")).toHaveValue("Chưa kịp lưu");
  await expect(again.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const after = (await (await again.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;
  expect(after.state.regions[0]?.translation).toBe("Chưa kịp lưu");
  expect(after.version).toBeGreaterThan(beforeCrash.version);
});

test("old per-page editor URL redirects to the chapter screen with ?page=", async ({ page }) => {
  await login(page);
  const chapterId = await committedChapter(page);
  const fakePage = "00000000-0000-7000-8000-000000000001";
  await page.goto(`/w/${ws}/series/${state.seriesId}/chapters/${chapterId}/edit/${fakePage}`);
  await expect(page).toHaveURL(`${WEB_URL}${chapterUrl(chapterId)}?page=${fakePage}`);
  await expect(page.getByRole("heading", { name: /^Chương / })).toBeVisible();
});

test("3-page strip: scroll to the end updates ?page=; rail click shows that page in the inspector", async ({
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
  await expect(page.getByLabel("Bản dịch vùng 1")).toHaveValue("Xin chào");
  await expect(page.getByRole("heading", { name: "Trang 1", exact: true })).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(50);
  }
  await expect(page).toHaveURL(new RegExp(`\\?page=${pageIds[2]}$`));
  await expect(page.locator(".cw-canvas-foot")).toContainText("Trang 3/3");

  const rail = page.getByRole("complementary", { name: "Danh sách trang" });
  await rail.getByRole("button", { name: /Trang 2/ }).click();
  await expect(page.getByRole("heading", { name: "Trang 2", exact: true })).toBeVisible();
  await expect(rail.getByRole("button", { name: /Trang 2/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Bản dịch vùng 1")).toHaveValue("Xin chào");

  // Sửa trang 2 rồi bấm trang 1 trên rail → trang 2 lưu trước khi đổi.
  await page.getByLabel("Bản dịch vùng 1").fill("Trang hai");
  await rail.getByRole("button", { name: /Trang 1/ }).click();
  await expect(page.getByRole("heading", { name: "Trang 1", exact: true })).toBeVisible();
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
  // Chỉ ingest + prepare: chương dừng ở "processing" (job dịch chờ trong hàng).
  await runUntil(page, chapterId, (p) => p.pages.length > 0 && p.pages.every((x) => x.status === "prepared"), {
    capabilities: ["chapter.ingest", "page.prepare"],
  });

  await page.goto(chapterUrl(chapterId));
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Đang dịch — sửa được khi xong");
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await page.waitForTimeout(1500);
  const detail = async () =>
    (await (await page.request.get(`/api/w/${ws}/chapters/${chapterId}`)).json()) as { lock: unknown; status: string };
  expect(await detail()).toMatchObject({ status: "processing", lock: null });

  const pages = await runUntil(page, chapterId, allReady);
  await expect(page.getByLabel("Bản dịch vùng 1")).toHaveValue("Xin chào", { timeout: 15_000 });
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
  const st = (await (await page.request.get(`/api/w/${ws}/pages/${pages[0]?.id}`)).json()) as {
    state_origin: string;
    ai_update_available: boolean;
  };
  expect(st).toMatchObject({ state_origin: "ai", ai_update_available: false });
});
