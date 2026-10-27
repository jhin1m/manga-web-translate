/**
 * Font tuỳ chỉnh của người dùng: upload ở Cài đặt chung → chọn làm font thoại mặc định của series → xoá bị chặn khi còn là
 * mặc định → editor liệt kê font ở nhóm "Font của bạn" và vẽ bằng nó → xoá font thì box cũ vẫn mở được (rơi về font
 * mặc định, không lỗi). Fixture: font gói sẵn trong worker/fonts.
 */
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { apiReadyChapter, login, openPanel, state } from "./helpers.ts";

const headers = { origin: WEB_URL };
const FIXTURE = fileURLToPath(new URL("../../../worker/fonts/Itim-Regular.ttf", import.meta.url));

type PageBody = { version: number; state: { text_boxes: unknown[] } & Record<string, unknown> };

const setDefaultFonts = async (page: import("@playwright/test").Page, default_fonts: Record<string, string>) =>
  expect((await page.request.patch(`/api/series/${state.seriesId}`, { headers, data: { default_fonts } })).ok()).toBe(
    true,
  );

test("upload a font, make it the series default, use it in the editor, then delete it", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await login(page);

  // Upload ở Cài đặt chung (link trong menu tài khoản).
  await page.getByLabel("Tài khoản", { exact: true }).click();
  await page.getByRole("link", { name: "Cài đặt chung" }).click();
  await expect(page.getByRole("heading", { name: "Cài đặt chung" })).toBeVisible();
  await page.getByLabel("Chọn file font").setInputFiles(FIXTURE);
  const row = page.getByRole("row", { name: /Itim/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Đủ dấu");
  const list = (await (await page.request.get(`/api/fonts`)).json()) as {
    fonts: { id: string; name: string }[];
  };
  const font = list.fonts.find((f) => /Itim/.test(f.name));
  if (!font) throw new Error("font not listed");

  // Chọn làm font thoại mặc định ở cài đặt series.
  await page.goto(`/s/${state.seriesId}?tab=settings`);
  const slot = page.getByLabel("Thoại", { exact: true });
  await expect(slot.locator("optgroup[label='Font của bạn'] option")).toHaveText([font.name]);
  await slot.selectOption(font.id);
  await page.getByRole("button", { name: "Lưu cài đặt" }).click();
  // Lưu đổi settings_rev → form dựng lại; kiểm kết quả ở server.
  await expect
    .poll(async () => {
      const s = (await (await page.request.get(`/api/series/${state.seriesId}`)).json()) as {
        default_fonts: { dialogue?: string };
      };
      return s.default_fonts.dialogue;
    })
    .toBe(font.id);

  // Còn là mặc định → không xoá được.
  await page.goto(`/settings`);
  await page.getByRole("button", { name: `Xoá font ${font.name}` }).click();
  await expect(page.getByRole("alert")).toContainText("Series e2e");
  await expect(row).toBeVisible();
  await setDefaultFonts(page, {});

  // Editor: box dùng font riêng → select chọn đúng font, font đã nạp vào trình duyệt.
  const chapterId = await apiReadyChapter(page, "9401");
  const progress = (await (await page.request.get(`/api/chapters/${chapterId}/progress`)).json()) as {
    pages: { id: string }[];
  };
  const pageId = progress.pages[0]?.id ?? "";
  const detail = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as PageBody;
  const box = {
    id: "tb-font",
    region_id: "t0",
    x: 40,
    y: 120,
    w: 200,
    h: 80,
    rotation: 0,
    text: "Xin chào",
    lines: ["Xin chào"],
    font_family: font.id,
    font_size: 22,
    line_height: 1.15,
    pad: 4,
    letter_spacing: 0,
    align: "center",
    fill: "#000000",
    stroke: null,
    auto_fit: false,
    hidden: false,
  };
  expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/pages/${pageId}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: { ...detail.state, text_boxes: [box] } },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);

  const chapterUrl = `/s/${state.seriesId}/c/${chapterId}`;
  await page.goto(chapterUrl);
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await openPanel(page, "table");
  await page.locator(".cw-tbody [data-row] .cw-src").first().click();
  await openPanel(page, "select");
  const fontSelect = page.locator("#ed-font");
  await expect(fontSelect).toHaveValue(font.id);
  await expect(fontSelect.locator("optgroup[label='Font của bạn'] option")).toHaveText([font.name]);
  expect(await page.evaluate((id) => document.fonts.check(`20px "${id}"`), font.id)).toBe(true);

  // Xoá font (không còn là mặc định) → box cũ vẫn mở được, select báo thiếu, không lỗi trang.
  await page.goto(`/settings`);
  await page.getByRole("button", { name: `Xoá font ${font.name}` }).click();
  await expect(row).toHaveCount(0);
  await page.goto(chapterUrl);
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await openPanel(page, "table");
  await page.locator(".cw-tbody [data-row] .cw-src").first().click();
  await openPanel(page, "select");
  await expect(page.locator("#ed-font")).toHaveValue(font.id);
  await expect(page.locator("#ed-font option:checked")).toContainText("(thiếu)");
  expect(pageErrors).toEqual([]);
});
