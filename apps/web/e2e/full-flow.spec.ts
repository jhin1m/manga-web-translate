/**
 * Luồng chính trọn vẹn: thả 1 strip ở home → màn chương mở ngay (trước khi upload xong, không qua dòng xác nhận)
 * → upload xong tự dịch (không bấm gì) → (đang dịch, nút khoá) → worker giả cắt 3 trang + dịch → sửa bản dịch
 * trang 2 trong bảng → lưu lên server → nút chính "Xuất" → drawer Xuất không cảnh báo → tải xuống 302. Không lỗi JS
 * nào trong cả luồng.
 */
import { expect, type Route, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

const ws = state.workspaceId;

type ProgressBody = { pages: { id: string; ord: number; status: string }[] };

test("drop a strip on home → translate → edit → export", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // Giữ POST lên storage tới khi đã ở màn chương → URL màn chương có trước khi upload xong.
  const held: Route[] = [];
  let hold = true;
  await page.route(
    (url) => !url.href.startsWith(WEB_URL),
    (route) => {
      if (hold && route.request().method() === "POST") held.push(route);
      else void route.continue();
    },
  );

  await login(page);
  await page
    .getByRole("region", { name: "Tạo chương mới" })
    .locator('input[type="file"]')
    .setInputFiles({ name: "Series e2e chapter 7001.png", mimeType: "image/png", buffer: PNG_1PX });

  // Series + số chương đoán từ tên file → tạo chương ngay, không hỏi.
  await expect(page).toHaveURL(/\/w\/.+\/s\/.+\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  expect(page.url()).toContain(`/s/${state.seriesId}/`);
  const chapterId = page.url().split("/").pop() ?? "";
  await expect(page.getByRole("heading", { name: /^Chương 7001/ })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Dịch chương" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Dịch chương" })).toHaveAttribute("title", /^Tự dịch khi tải xong/);
  hold = false;
  for (const r of held.splice(0)) await r.continue();

  // Upload xong → tự dịch: (Xuất bị khoá, chip "Đang cắt trang/Đang dịch") → Xuất. Thành công không thêm banner.
  const chip = page.getByRole("status", { name: "Trạng thái chương" });
  await expect(chip).toHaveText(/^Đang (cắt trang|dịch)/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Xuất", exact: true })).toBeDisabled();
  await expect(page.getByText(/Bắt đầu dịch|Đang dịch \d+ ảnh/)).toHaveCount(0);

  let ready = false;
  const worker = runFakeWorker(state.token, () => ready, 60_000, { pagesPerSource: 3 });
  const rail = page.getByRole("complementary", { name: "Danh sách trang" });
  await expect(rail.locator(".status", { hasText: "Xong" })).toHaveCount(3, { timeout: 30_000 });
  const primary = page.getByRole("button", { name: "Xuất", exact: true });
  await expect(primary).toBeEnabled({ timeout: 15_000 });
  await expect(chip).toHaveText(/^Chờ duyệt/);
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
  // Trạng thái bình thường không chiếm dải riêng dưới thanh trên.
  await expect(page.getByRole("alert", { name: "Cảnh báo chương" })).toHaveCount(0);

  // Sửa bản dịch trang 2 trong bảng văn bản → "Đã lưu" → API khớp.
  const progress = (await (
    await page.request.get(`/api/w/${ws}/chapters/${chapterId}/progress`)
  ).json()) as ProgressBody;
  const p2 = progress.pages.find((p) => p.ord === 1)?.id ?? "";
  await page.getByRole("tab", { name: /^Bản dịch/ }).click();
  const cell = page.getByLabel("Bản dịch trang 2 vùng 1", { exact: true });
  await cell.click();
  await expect(cell).not.toHaveAttribute("readonly");
  await cell.fill("Chào cậu");
  await expect(page.locator(".status", { hasText: "Đã lưu" })).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => {
      const r = (await (await page.request.get(`/api/w/${ws}/pages/${p2}`)).json()) as {
        state: { regions: { translation: string }[] };
      };
      return r.state.regions[0]?.translation;
    })
    .toBe("Chào cậu");

  // Xuất: drawer không cảnh báo → job qua worker giả → "Tải xuống" 302.
  await primary.click();
  const dlg = page.getByRole("dialog", { name: "Xuất chương" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("region", { name: "Trước khi xuất" })).toHaveCount(0);
  await dlg.getByRole("button", { name: "Xuất ZIP PNG", exact: true }).click();
  const link = dlg.getByRole("link", { name: "Tải xuống" });
  await expect(link).toBeVisible({ timeout: 60_000 });
  ready = true;
  await worker;
  const r = await page.request.get((await link.getAttribute("href")) as string, { maxRedirects: 0 });
  expect(r.status()).toBe(302);

  expect(pageErrors).toEqual([]);
});
