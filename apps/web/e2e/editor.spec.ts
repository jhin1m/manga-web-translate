/**
 * Editor: sửa bản dịch → autosave → reload còn nguyên; mất kết nối lưu rồi đóng tab giữa chừng → mở lại đề nghị
 * khôi phục từ IndexedDB → khôi phục → lưu lên server. Chương 1 trang tạo qua API + worker giả.
 */
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { type E2EState, STATE_FILE, WEB_URL } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;
const ws = state.workspaceId;
const headers = { origin: WEB_URL };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Mật khẩu").fill(state.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();
}

/** Chương 1 trang đã dịch (worker giả) → id chương + page. */
async function readyChapter(page: Page) {
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

  let pageId: string | null = null;
  const deadline = Date.now() + 30_000;
  let done = false;
  const worker = runFakeWorker(state.token, () => done, 30_000);
  while (!pageId && Date.now() < deadline) {
    const p = (await (await page.request.get(`/api/w/${ws}/chapters/${chapter.id}/progress`)).json()) as {
      pages: { id: string; status: string }[];
    };
    if (p.pages.length && p.pages.every((x) => x.status === "ready")) pageId = p.pages[0]?.id ?? null;
    else await page.waitForTimeout(300);
  }
  done = true;
  await worker;
  if (!pageId) throw new Error("page not ready");
  return { chapterId: chapter.id, pageId };
}

const editorUrl = (chapterId: string, pageId: string) =>
  `/w/${ws}/series/${state.seriesId}/chapters/${chapterId}/edit/${pageId}`;

test("edit translation → autosave → reload keeps it; crash mid-edit → restore unsaved changes", async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);

  await page.goto(editorUrl(chapterId, pageId));
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

  // So sánh ảnh gốc ↔ bản dịch (đổi layer ảnh, tile cũ không bị vẽ sau khi close).
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  for (const label of ["Đang xem: ảnh gốc", "Đang xem: bản dịch", "Đang xem: ảnh gốc", "Đang xem: bản dịch"]) {
    await page.keyboard.press("\\");
    await expect(page.getByRole("button", { name: label })).toBeVisible();
    await page.waitForTimeout(150);
  }
  expect(pageErrors).toEqual([]);

  // Undo/redo bằng phím tắt.
  await page.getByLabel("Bản dịch vùng 1").fill("Tạm");
  await page.locator(".ed-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Bản dịch vùng 1")).toHaveValue("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });

  // Rời editor ngay sau khi sửa (trước debounce 2s) → vẫn lưu trước khi nhả khoá.
  const lockedPuts: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.url().endsWith("/state") && r.status() === 423) lockedPuts.push(1);
  });
  await page.getByLabel("Bản dịch vùng 1").fill("Rời ngay");
  await page.getByRole("link", { name: "← Chương" }).click();
  await expect(page).toHaveURL(new RegExp(`/chapters/${chapterId}$`));
  await expect
    .poll(async () => {
      const r = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;
      return r.state.regions[0]?.translation;
    })
    .toBe("Rời ngay");
  // Lượt lưu cuối tới server trước lệnh nhả khoá (không có PUT nào bị 423).
  expect(lockedPuts).toEqual([]);
  await page.goto(editorUrl(chapterId, pageId));
  await page.getByLabel("Bản dịch vùng 1").fill("Chào cậu, ệ ẫ ữ");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const beforeCrash = (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;

  // "Crash": PUT không tới server, đóng tab khi đang có thay đổi chưa lưu.
  await page.route("**/state", (route) => route.abort());
  await page.getByLabel("Bản dịch vùng 1").fill("Chưa kịp lưu");
  await page.waitForTimeout(800);
  await page.close();

  const again = await context.newPage();
  await again.goto(editorUrl(chapterId, pageId));
  await expect(again.getByText(/thay đổi chưa lưu từ phiên trước/)).toBeVisible();
  await expect(again.getByLabel("Bản dịch vùng 1")).toHaveValue("Chào cậu, ệ ẫ ữ");
  await again.getByRole("button", { name: "Khôi phục" }).click();
  await expect(again.getByLabel("Bản dịch vùng 1")).toHaveValue("Chưa kịp lưu");
  await expect(again.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  const after = (await (await again.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as typeof saved;
  expect(after.state.regions[0]?.translation).toBe("Chưa kịp lưu");
  expect(after.version).toBeGreaterThan(beforeCrash.version);
});
