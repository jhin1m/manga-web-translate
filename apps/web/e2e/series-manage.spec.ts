/**
 * Quản lý series / chương: xoá series từ hàng series ở home và xoá chương từ hàng chương (xác nhận tại chỗ; Huỷ không
 * xoá), chuyển tab Chương / Glossary / Cài đặt giữ nguyên đầu trang series; chọn ngôn ngữ gốc khi tạo series và
 * sửa ngôn ngữ đích / định dạng truyện trong Cài đặt.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

test("delete a whole series from its home row, after an explicit confirm", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/w/${state.workspaceId}/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series xoá e2e" },
  });
  expect(created.status()).toBe(201);
  const s = (await created.json()) as { id: string };
  const chapter = await page.request.post(`/api/w/${state.workspaceId}/chapters`, {
    headers: { origin: WEB_URL },
    data: {
      series_id: s.id,
      number: "1",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(chapter.status()).toBe(201);

  await page.goto("/");
  const row = page.locator(`.row-item[data-series="${s.id}"]`);
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Xoá series Series xoá e2e" }).click();
  await expect(row.getByText("cùng 1 chương")).toBeVisible();
  await row.getByRole("button", { name: "Huỷ" }).click();
  await expect(row.getByRole("link", { name: /^Series xoá e2e/ })).toBeVisible();

  await row.getByRole("button", { name: "Xoá series Series xoá e2e" }).click();
  await row.getByRole("button", { name: "Xoá series", exact: true }).click();
  await expect(row).toHaveCount(0);
  const gone = await page.request.get(`/api/w/${state.workspaceId}/series/${s.id}`);
  expect(gone.status()).toBe(404);
});

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

test("new series picks source language; settings edit target language, page format and ignored text", async ({
  page,
}) => {
  await login(page);
  await page.goto("/");
  await page.getByRole("button", { name: "+ Series mới" }).click();
  await page.getByLabel("Tên series mới").fill("Manga Nhật e2e");
  await page.getByLabel("Ngôn ngữ gốc").selectOption("ja");
  await page.getByRole("button", { name: "Tạo series" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Manga Nhật e2e" })).toBeVisible();
  await expect(page.getByText(/Nhật → Việt/)).toBeVisible();

  await page.getByRole("navigation", { name: "Mục của series" }).getByRole("link", { name: "Cài đặt dịch" }).click();
  // ja → server tự chọn "Từng trang"; nguồn chưa kiểm định chỉ ghi chú, không chặn lưu.
  await expect(page.getByLabel("Định dạng truyện")).toHaveValue("pages");
  await expect(page.getByText("Chưa kiểm định kỹ")).toBeVisible();
  await page.getByLabel("Ngôn ngữ đích").selectOption("en");
  await page.getByLabel("Định dạng truyện").selectOption("strip");
  await page.getByRole("button", { name: "Lưu cài đặt" }).click();
  // Lưu đổi settings_rev → form dựng lại theo giá trị mới từ server.
  await expect(page.getByText(/Nhật → Anh/)).toBeVisible();
  await expect(page.getByLabel("Định dạng truyện")).toHaveValue("strip");

  // Chữ bỏ qua (watermark): dòng quá ngắn báo lỗi tại dòng, chặn lưu; sửa xong lưu được, mục trùng gộp lại.
  const ignore = page.getByLabel("Chữ bỏ qua (watermark)");
  await ignore.fill("discord.gg/nhom\nab");
  await expect(page.getByText("Dòng 2: mỗi mục 3–100 ký tự (không tính http://).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu cài đặt" })).toBeDisabled();
  await ignore.fill("discord.gg/nhom\nDISCORD.GG/NHOM\nNhóm Mèo");
  await page.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu" })).toBeVisible();
  await expect(ignore).toHaveValue("discord.gg/nhom\nNhóm Mèo");

  const url = new URL(page.url());
  const seriesId = url.pathname.split("/").at(-1) as string;
  const s = (await (await page.request.get(`/api/w/${state.workspaceId}/series/${seriesId}`)).json()) as {
    source_lang: string;
    target_lang: string;
    page_format: string;
    ignore_text: string[];
  };
  expect([s.source_lang, s.target_lang, s.page_format]).toEqual(["ja", "en", "strip"]);
  expect(s.ignore_text).toEqual(["discord.gg/nhom", "Nhóm Mèo"]);
});
