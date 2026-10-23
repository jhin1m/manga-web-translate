/**
 * Cài đặt nhóm → Pipeline: owner đổi OCR engine tiếng Nhật + nới mask (Nâng cao), lưu, tải lại vẫn giữ; về mặc định.
 * Tab Font vẫn là mặc định của trang.
 */
import { expect, test } from "@playwright/test";
import { login, state } from "./helpers.ts";

const ws = state.workspaceId;

test("owner edits pipeline settings and they persist", async ({ page }) => {
  await login(page);
  await page.goto(`/w/${ws}/settings`);
  await page.getByRole("link", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(/tab=pipeline/);

  const ja = page.getByLabel(/Tiếng Nhật OCR engine/);
  await expect(ja).toHaveValue("llm");
  // Tiếng Hàn không có MangaOCR (chỉ tiếng Nhật).
  await expect(page.getByLabel(/Tiếng Hàn OCR engine/).locator("option")).toHaveText([
    /AI \(LLM vision\)/,
    /PaddleOCR/,
  ]);
  await ja.selectOption("manga_ocr");
  await page.getByText("Nâng cao").click();
  await page.getByLabel(/Nới mask/).fill("4");
  await page.getByLabel(/Model xoá chữ/).selectOption("lama_manga");
  await page.getByRole("button", { name: "Lưu cài đặt pipeline" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu." })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/Tiếng Nhật OCR engine/)).toHaveValue("manga_ocr");
  await expect(page.getByLabel(/Model xoá chữ/)).toHaveValue("lama_manga");
  await expect(page.getByLabel(/Nới mask/)).toHaveValue("4");

  // Trả về mặc định để không ảnh hưởng spec khác (DB e2e dùng chung).
  await page.getByRole("button", { name: "Về mặc định" }).click();
  await page.getByRole("button", { name: "Lưu cài đặt pipeline" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Tiếng Nhật OCR engine/)).toHaveValue("llm");
});
