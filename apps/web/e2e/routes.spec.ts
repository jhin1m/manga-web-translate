/**
 * Cây route một người dùng: `/`, `/s/$seriesId[?tab]`, `/s/$seriesId/c/$chapterId[?page]`, `/glossary`, `/settings`.
 * Không có id tài khoản trên URL; path cũ `/w/...` không còn (production chưa có người dùng thật) → trang không tìm thấy.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

const s = state.seriesId;

test("series, chapter, glossary and settings open at their own URLs; old /w/ paths are gone", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/chapters", {
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

  await page.goto(`/s/${s}?tab=settings`);
  await expect(
    page.getByRole("navigation", { name: "Mục của series" }).getByRole("link", { name: "Cài đặt dịch" }),
  ).toHaveAttribute("aria-current", "page");

  const fakePage = "00000000-0000-7000-8000-000000000001";
  await page.goto(`/s/${s}/c/${c}?page=${fakePage}`);
  await expect(page).toHaveURL(`${WEB_URL}/s/${s}/c/${c}?page=${fakePage}`);
  await expect(page.getByRole("heading", { name: /^Chương / })).toBeVisible();

  await page.goto("/glossary");
  await expect(page.getByRole("heading", { name: "Glossary chung" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Cài đặt chung" })).toBeVisible();

  await page.goto(`/w/${s}/s/${s}`);
  await expect(page.getByRole("heading", { name: "Không tìm thấy trang" })).toBeVisible();
});
