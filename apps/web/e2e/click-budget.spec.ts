/**
 * Ngân sách click từ home tới editor chương (≤ 3): qua "Việc cần làm" = 1 click ("Tiếp tục sửa"), qua series = 2
 * click (thẻ series → "Mở" ở hàng chương). Chỉ đếm click có điều hướng.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { apiReadyChapter, login } from "./helpers.ts";

const NUMBER = "8001";

/** Click rồi chờ URL đổi → +1 vào bộ đếm. */
async function navClick(page: Page, target: Locator, count: { n: number }) {
  const before = page.url();
  await target.click();
  await expect(page).not.toHaveURL(before);
  count.n++;
}

async function expectChapterCanvas(page: Page) {
  await expect(page).toHaveURL(/\/w\/.+\/s\/.+\/c\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: new RegExp(`^Chương ${NUMBER}`) })).toBeVisible();
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
}

test("home → chapter editor within the click budget", async ({ page }) => {
  await login(page);
  await apiReadyChapter(page, NUMBER);

  // Đường "Việc cần làm": 1 click.
  await page.goto("/");
  const todo = page.getByRole("region", { name: "Việc cần làm" });
  const row = todo
    .locator(".row-item")
    .filter({ has: page.getByRole("link", { name: `Chương ${NUMBER}`, exact: true }) });
  const viaTodo = { n: 0 };
  await navClick(page, row.getByRole("link", { name: "Tiếp tục sửa" }), viaTodo);
  await expectChapterCanvas(page);
  expect(viaTodo.n).toBe(1);

  // Đường series: thẻ series → "Mở" ở hàng chương = 2 click.
  await page.goto("/");
  const viaSeries = { n: 0 };
  await navClick(
    page,
    page.getByRole("region", { name: "Series" }).getByRole("link", { name: "Series e2e" }),
    viaSeries,
  );
  const chapterRow = page.locator(".row-item", { has: page.locator(".ch-num", { hasText: `Ch.${NUMBER}` }) });
  await navClick(page, chapterRow.getByRole("link", { name: "Mở", exact: true }), viaSeries);
  await expectChapterCanvas(page);
  expect(viaSeries.n).toBe(2);
  expect(Math.max(viaTodo.n, viaSeries.n)).toBeLessThanOrEqual(3);
});
