/**
 * AI hiệu đính: tab "Hiệu đính" của panel Văn bản → chạy (job chapter.proofread qua worker giả) → gợi ý cũ → mới + lý do →
 * Nhận = sửa bản dịch như gõ tay (autosave, version) → hoàn tác trả gợi ý về "Chờ duyệt" → Bỏ thì gợi ý biến mất.
 */
import { expect, test } from "@playwright/test";
import { runFakeWorker } from "./fake-worker.ts";
import { apiReadyChapter, docTab, login, openPanel, state } from "./helpers.ts";

test("run AI proofread, accept a suggestion through the normal edit path, undo, dismiss", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);
  const chapterId = await apiReadyChapter(page, "4101");
  const pages = (await (await page.request.get(`/api/chapters/${chapterId}/pages`)).json()) as {
    pages: { id: string }[];
  };
  const pageId = pages.pages[0]?.id ?? "";
  const translation = async () =>
    (
      (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
        state: { regions: { translation: string }[] };
      }
    ).state.regions[0]?.translation;

  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  const panel = await openPanel(page, "proofread");
  await panel.getByRole("button", { name: "Chạy AI hiệu đính" }).click();
  // Xác nhận trước khi chạy: 1 dòng trang · giá · thời gian; dữ liệu gửi lên AI nằm ở ⓘ cạnh nút Chạy.
  const confirm = panel.getByRole("region", { name: "Xác nhận chạy AI hiệu đính" });
  await expect(confirm).toContainText(/\d+ trang · (dưới \$0\.01|\$[\d.]+ – \$[\d.]+).* · (khoảng|dưới) /);
  await expect(confirm.locator("p")).toHaveCount(1);
  const tip = confirm.getByRole("button", { name: "Dữ liệu gửi lên AI" });
  await tip.focus();
  await expect(confirm.getByRole("tooltip")).toContainText("ảnh từng trang");
  await confirm.getByRole("button", { name: "Chạy hiệu đính" }).click();

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
  // Nhãn tab đếm gợi ý chờ duyệt.
  await expect(docTab(page, "proofread")).toHaveText("Hiệu đính · 1");
  // Gợi ý không tự ghi đè bản dịch.
  expect(await translation()).toBe("Xin chào");

  await item.getByRole("button", { name: "Nhận" }).click();
  await expect(item).toContainText("Đã nhận");
  await expect(docTab(page, "proofread")).toHaveText("Hiệu đính");
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Đã lưu", { timeout: 10_000 });
  await expect.poll(translation, { timeout: 10_000 }).toBe("Xin chào, cậu khoẻ không?");

  // Hoàn tác (undo của editor) → bản cũ, gợi ý lại "Chờ duyệt".
  await page.keyboard.press("ControlOrMeta+z");
  await expect(item).toContainText("Chờ duyệt");
  await expect(docTab(page, "proofread")).toHaveText("Hiệu đính · 1");
  await expect.poll(translation, { timeout: 10_000 }).toBe("Xin chào");

  await item.getByRole("button", { name: "Bỏ" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
