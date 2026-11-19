/**
 * Xem danh sách series (home) và chương (màn series): đổi tiêu chí / chiều sắp xếp đổi thứ tự ngay, chuyển Danh sách
 * thì không còn ảnh, tải lại vẫn giữ lựa chọn của từng màn, xoá chương ở dạng danh sách vẫn qua bước xác nhận.
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { login } from "./helpers.ts";

const headers = { origin: WEB_URL };

async function apiSeries(page: Page, title: string) {
  const created = await page.request.post(`/api/series`, { headers, data: { title } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function apiChapter(page: Page, seriesId: string, number: string) {
  const created = await page.request.post(`/api/chapters`, {
    headers,
    data: {
      series_id: seriesId,
      number,
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { chapter: { id: string } }).chapter.id;
}

const names = (page: Page) => page.locator(".card .card-name");

test("home sorts series by name both ways, switches to a list without covers and remembers it", async ({ page }) => {
  await login(page);
  const ids = [
    await apiSeries(page, "Xếp e2e Bạch"),
    await apiSeries(page, "xếp e2e an"),
    await apiSeries(page, "Xếp e2e Cá"),
  ];
  try {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Tìm series" }).fill("xếp e2e");
    // Mặc định: hoạt động gần nhất, mới trước → series tạo sau cùng đứng đầu.
    await expect(names(page)).toHaveText(["Xếp e2e Cá", "xếp e2e an", "Xếp e2e Bạch"]);

    await page.getByRole("combobox", { name: "Sắp xếp theo" }).selectOption({ label: "Tên" });
    await expect(names(page)).toHaveText(["xếp e2e an", "Xếp e2e Bạch", "Xếp e2e Cá"]);
    await page.getByRole("button", { name: /Chiều sắp xếp: A→Z/ }).click();
    await expect(names(page)).toHaveText(["Xếp e2e Cá", "Xếp e2e Bạch", "xếp e2e an"]);

    await expect(page.locator(".card-grid .card img, .card-grid .cover").first()).toBeVisible();
    await page.getByRole("button", { name: "Danh sách" }).click();
    await expect(page.getByRole("button", { name: "Danh sách" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".card-list .card")).toHaveCount(3);
    await expect(page.locator(".card-list .cover")).toHaveCount(0);

    await page.reload();
    await page.getByRole("searchbox", { name: "Tìm series" }).fill("xếp e2e");
    await expect(page.locator(".card-list .card")).toHaveCount(3);
    await expect(names(page)).toHaveText(["Xếp e2e Cá", "Xếp e2e Bạch", "xếp e2e an"]);
    await expect(page.getByRole("combobox", { name: "Sắp xếp theo" })).toHaveValue("title");
  } finally {
    for (const id of ids) await page.request.delete(`/api/series/${id}`, { headers });
  }
});

test("series page sorts chapters numerically, lists them without thumbnails and deletes after a confirm", async ({
  page,
}) => {
  await login(page);
  const seriesId = await apiSeries(page, "Xếp chương e2e");
  try {
    await apiChapter(page, seriesId, "10");
    const ch2 = await apiChapter(page, seriesId, "2");
    await apiChapter(page, seriesId, "1.5");

    await page.goto(`/s/${seriesId}`);
    await expect(names(page)).toHaveText(["Ch.1.5", "Ch.2", "Ch.10"]);
    await page.getByRole("button", { name: /Chiều sắp xếp: Tăng dần/ }).click();
    await expect(names(page)).toHaveText(["Ch.10", "Ch.2", "Ch.1.5"]);

    await page.getByRole("button", { name: "Danh sách" }).click();
    await expect(page.locator(".card-list .card")).toHaveCount(3);
    await expect(page.locator(".card-list .cover")).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".card-list .card")).toHaveCount(3);
    await expect(names(page)).toHaveText(["Ch.10", "Ch.2", "Ch.1.5"]);

    const row = page.locator(`.card[data-chapter="${ch2}"]`);
    await row.getByRole("button", { name: "Xoá chương 2" }).click();
    await row.getByRole("button", { name: "Huỷ" }).click();
    await expect(row.getByRole("link", { name: "Mở chương 2" })).toBeVisible();
    await row.getByRole("button", { name: "Xoá chương 2" }).click();
    await row.getByRole("button", { name: "Xoá chương", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(names(page)).toHaveText(["Ch.10", "Ch.1.5"]);

    // Màn home nhớ riêng: vẫn là lưới mặc định.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Lưới" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.request.delete(`/api/series/${seriesId}`, { headers });
  }
});
