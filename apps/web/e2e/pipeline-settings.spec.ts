/**
 * Cài đặt admin → Pipeline: admin đổi OCR engine tiếng Nhật (mặc định MangaOCR local → LLM), nới vùng xoá, model xoá
 * chữ — mỗi lần đổi tự lưu; tải lại vẫn giữ; "Về mặc định" (hỏi lại) trả về như cũ.
 * Pipeline là mục mặc định của trang.
 */
import { expect, type Page, test } from "@playwright/test";
import { login } from "./helpers.ts";

const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: "Đã lưu" })).toBeVisible();

test("owner edits pipeline settings and they persist", async ({ page }) => {
  await login(page);
  await page.goto(`/settings?section=pipeline`);
  await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();

  const ocr = page.getByRole("region", { name: "Đọc chữ (OCR)" });
  const ja = ocr.getByLabel("Tiếng Nhật", { exact: true });
  await expect(ja).toHaveValue("manga_ocr");
  await expect(ocr.getByLabel("Tiếng Hàn", { exact: true })).toHaveValue("paddle_ocr");
  // Tiếng Hàn không có MangaOCR (chỉ tiếng Nhật).
  await expect(ocr.getByLabel("Tiếng Hàn", { exact: true }).locator("option")).toHaveText([
    /AI \(LLM vision\)/,
    /PaddleOCR/,
  ]);
  await ja.selectOption("llm");
  await saved(page);
  const dilation = page.getByLabel("Nới vùng xoá (px)");
  await dilation.fill("4");
  await dilation.press("Enter");
  await saved(page);
  const inpainter = page.getByRole("region", { name: "Xoá chữ" }).getByLabel("Model", { exact: true });
  await inpainter.selectOption("lama_manga");
  await saved(page);

  await page.reload();
  await expect(ja).toHaveValue("llm");
  await expect(inpainter).toHaveValue("lama_manga");
  await expect(dilation).toHaveValue("4");

  // Ô số sai không lưu: báo lỗi tại chỗ, server giữ giá trị cũ.
  await dilation.fill("99");
  await dilation.press("Enter");
  await expect(dilation).toHaveAttribute("aria-invalid", "true");

  // Trả về mặc định để không ảnh hưởng spec khác (DB e2e dùng chung).
  await page.getByRole("button", { name: "Về mặc định" }).click();
  await page.getByRole("button", { name: "Về mặc định?" }).click();
  await saved(page);
  await page.reload();
  await expect(ja).toHaveValue("manga_ocr");
  await expect(dilation).toHaveValue("");
});
