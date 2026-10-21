/**
 * Ngân sách click từ home tới editor chương (≤ 3): hàng series → hàng chương = 2 click. Chỉ đếm click có điều hướng. Chương mới: thả ảnh ở home = 1 thao tác
 * duy nhất tới khi chương đang dịch (không dòng xác nhận, không bấm "Dịch chương").
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { apiReadyChapter, login, state } from "./helpers.ts";

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

  // Hàng series → hàng chương = 2 click.
  await page.goto("/");
  const viaSeries = { n: 0 };
  await navClick(
    page,
    page.getByRole("region", { name: "Series" }).getByRole("link", { name: "Series e2e" }),
    viaSeries,
  );
  await navClick(page, page.getByRole("link", { name: `Mở chương ${NUMBER}`, exact: true }), viaSeries);
  await expectChapterCanvas(page);
  expect(viaSeries.n).toBe(2);
});

test("drop 5 images on home → translating chapter with no further action", async ({ page }) => {
  await login(page);
  const clicks = { n: 0 };
  // Đếm mọi click trong trang (SPA: cùng document suốt luồng).
  await page.exposeFunction("countClick", () => clicks.n++);
  await page.evaluate(() =>
    document.addEventListener("click", () => (window as unknown as { countClick: () => void }).countClick(), true),
  );

  // Lần thả = thao tác duy nhất.
  await page
    .getByRole("region", { name: "Tạo chương mới" })
    .locator('input[type="file"]')
    .setInputFiles(
      ["001.png", "002.png", "003.png", "004.png", "005.png"].map((name) => ({
        name,
        mimeType: "image/png",
        buffer: PNG_1PX,
      })),
    );
  await expect(page).toHaveURL(/\/w\/.+\/s\/.+\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("status", { name: "Trạng thái chương" })).toHaveText(/^Đang (cắt trang|dịch)/, {
    timeout: 30_000,
  });
  expect(clicks.n).toBe(0);

  // Dọn: không để job ingest treo cho spec sau (worker giả claim mọi job của workspace).
  const chapterId = page.url().split("/").pop() ?? "";
  const r = await page.request.post(`/api/w/${state.workspaceId}/chapters/${chapterId}/cancel`, {
    headers: { origin: WEB_URL },
  });
  expect(r.status()).toBe(200);
});
