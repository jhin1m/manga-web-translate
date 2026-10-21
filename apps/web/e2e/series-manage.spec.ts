/**
 * Quản lý ở màn series: xoá chương từ hàng chương (xác nhận tại chỗ; Huỷ không xoá), chuyển tab Chương / Glossary /
 * Cài đặt giữ nguyên đầu trang series.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

test("delete a chapter from the series page, after an explicit confirm", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/w/${state.workspaceId}/chapters`, {
    headers: { origin: WEB_URL },
    data: {
      series_id: state.seriesId,
      number: "9301",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  const { chapter } = (await created.json()) as { chapter: { id: string } };

  await page.goto(`/w/${state.workspaceId}/s/${state.seriesId}`);
  const row = page.locator(`.row-item[data-chapter="${chapter.id}"]`);
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Xoá chương 9301" }).click();
  await row.getByRole("button", { name: "Huỷ" }).click();
  await expect(row.getByRole("link", { name: "Mở chương 9301" })).toBeVisible();

  await row.getByRole("button", { name: "Xoá chương 9301" }).click();
  await row.getByRole("button", { name: "Xoá chương", exact: true }).click();
  await expect(row).toHaveCount(0);
  const gone = await page.request.get(`/api/w/${state.workspaceId}/chapters/${chapter.id}`);
  expect(gone.status()).toBe(404);
});

test("series tabs keep the series header and mark the current tab", async ({ page }) => {
  await login(page);
  await page.goto(`/w/${state.workspaceId}/s/${state.seriesId}`);
  const tabs = page.getByRole("navigation", { name: "Mục của series" });
  await tabs.getByRole("link", { name: "Cài đặt dịch" }).click();
  await expect(page).toHaveURL(/\?tab=settings/);
  await expect(page.getByRole("heading", { level: 1, name: "Series e2e" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Cài đặt dịch" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: /^Chương/ })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Tên series", { exact: true })).toHaveValue("Series e2e");

  await tabs.getByRole("link", { name: /^Glossary/ }).click();
  await expect(page).toHaveURL(/\?tab=glossary/);
  await expect(page.getByRole("form", { name: "Thêm từ vào glossary" })).toBeVisible();
});
