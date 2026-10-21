/**
 * Path cũ (bookmark) redirect sang cây route mới; `/` là home của workspace hiện tại. Đủ 6 path cũ của sitemap:
 * workspace, danh sách series, series, cài đặt series, trang upload riêng, chương, editor 1 trang.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

const ws = state.workspaceId;
const s = state.seriesId;

test("old workspace/series/upload/chapter/editor URLs redirect to the new routes", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/w/${ws}/chapters`, {
    headers: { origin: WEB_URL },
    // Chương chưa upload ảnh: đủ để mở màn chương.
    data: {
      series_id: s,
      number: "9001",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  const c = ((await created.json()) as { chapter: { id: string } }).chapter.id;

  await page.goto(`/w/${ws}`);
  await expect(page).toHaveURL(`${WEB_URL}/`);
  await page.goto(`/w/${ws}/series`);
  await expect(page).toHaveURL(`${WEB_URL}/`);
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();

  await page.goto(`/w/${ws}/series/${s}`);
  await expect(page).toHaveURL(`${WEB_URL}/w/${ws}/s/${s}`);
  await page.goto(`/w/${ws}/series/${s}/settings`);
  await expect(page).toHaveURL(`${WEB_URL}/w/${ws}/s/${s}?tab=settings`);
  await expect(
    page.getByRole("navigation", { name: "Mục của series" }).getByRole("link", { name: "Cài đặt dịch" }),
  ).toHaveAttribute("aria-current", "page");

  // Trang upload riêng đã bỏ: về màn series (vùng thả chương tiếp theo).
  await page.goto(`/w/${ws}/series/${s}/upload`);
  await expect(page).toHaveURL(`${WEB_URL}/w/${ws}/s/${s}`);
  await expect(page.getByRole("region", { name: "Thêm chương tiếp theo" })).toBeVisible();

  await page.goto(`/w/${ws}/series/${s}/chapters/${c}`);
  await expect(page).toHaveURL(`${WEB_URL}/w/${ws}/s/${s}/c/${c}`);
  await expect(page.getByRole("heading", { name: /^Chương / })).toBeVisible();

  // Editor 1 trang cũ → màn chương mở đúng page.
  const fakePage = "00000000-0000-7000-8000-000000000001";
  await page.goto(`/w/${ws}/series/${s}/chapters/${c}/edit/${fakePage}`);
  await expect(page).toHaveURL(`${WEB_URL}/w/${ws}/s/${s}/c/${c}?page=${fakePage}`);
  await expect(page.getByRole("heading", { name: /^Chương / })).toBeVisible();
});
