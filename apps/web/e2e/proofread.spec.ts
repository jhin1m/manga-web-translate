/**
 * AI hiệu đính: panel "Hiệu đính" trên rail → chạy (job chapter.proofread qua worker giả) → gợi ý cũ → mới + lý do →
 * Nhận = sửa bản dịch như gõ tay (autosave, version) → hoàn tác trả gợi ý về "Chờ duyệt" → Bỏ thì gợi ý biến mất.
 */
import { expect, test } from "@playwright/test";
import { runFakeWorker } from "./fake-worker.ts";
import { apiReadyChapter, login, openPanel, state } from "./helpers.ts";

const ws = state.workspaceId;

test("run AI proofread, accept a suggestion through the normal edit path, undo, dismiss", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);
  const chapterId = await apiReadyChapter(page, "4101");
  const pages = (await (await page.request.get(`/api/w/${ws}/chapters/${chapterId}/pages`)).json()) as {
    pages: { id: string }[];
  };
  const pageId = pages.pages[0]?.id ?? "";
  const translation = async () =>
    (
      (await (await page.request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as {
        state: { regions: { translation: string }[] };
      }
    ).state.regions[0]?.translation;

  await page.goto(`/w/${ws}/s/${state.seriesId}/c/${chapterId}`);
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  const panel = await openPanel(page, "proofread");
  await panel.getByRole("button", { name: "Chạy AI hiệu đính" }).click();

  let stop = false;
  const worker = runFakeWorker(state.token, () => stop, 30_000, { capabilities: ["chapter.proofread"] });
  const list = panel.getByRole("list", { name: "Gợi ý hiệu đính" });
  try {
    await expect(list.getByRole("listitem")).toHaveCount(1, { timeout: 20_000 });
  } finally {
    stop = true;
    await worker;
  }
  const item = list.getByRole("listitem").first();
  await expect(item).toContainText("Xin chào, cậu khoẻ không?");
  await expect(item).toContainText("thiếu câu hỏi thăm theo ngữ cảnh");
  await expect(item).toContainText("Chờ duyệt");
  // Gợi ý không tự ghi đè bản dịch.
  expect(await translation()).toBe("Xin chào");

  await item.getByRole("button", { name: "Nhận" }).click();
  await expect(item).toContainText("Đã nhận");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(translation, { timeout: 10_000 }).toBe("Xin chào, cậu khoẻ không?");

  // Hoàn tác (undo của editor) → bản cũ, gợi ý lại "Chờ duyệt".
  await page.keyboard.press("ControlOrMeta+z");
  await expect(item).toContainText("Chờ duyệt");
  await expect.poll(translation, { timeout: 10_000 }).toBe("Xin chào");

  await item.getByRole("button", { name: "Bỏ" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
