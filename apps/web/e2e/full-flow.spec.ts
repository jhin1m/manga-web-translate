/**
 * Luồng chính trọn vẹn: thả 1 strip ở home → màn chương mở ngay (trước khi upload xong) → "Dịch chương" → (đang
 * dịch, nút khoá) → worker giả cắt 3 trang + dịch → sửa bản dịch trang 2 trong bảng → lưu lên server → nút chính
 * "Xuất" → drawer Xuất không cảnh báo → tải xuống 302. Không lỗi JS nào trong cả luồng.
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
    .setInputFiles({ name: "strip.png", mimeType: "image/png", buffer: PNG_1PX });
  const confirm = page.getByRole("form", { name: "Sau khi thả file" });
  await confirm.getByLabel("Series (đoán từ tên file)").selectOption({ label: "Series e2e" });
  await confirm.getByLabel("Chương số").fill("7001");
  await confirm.getByRole("button", { name: "Tạo và mở chương" }).click();

  await expect(page).toHaveURL(/\/w\/.+\/s\/.+\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const chapterId = page.url().split("/").pop() ?? "";
  await expect(page.getByRole("heading", { name: /^Chương 7001/ })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Dịch chương" })).toBeDisabled();
  hold = false;
  for (const r of held.splice(0)) await r.continue();

  // Nút chính: Dịch chương → (khoá) Đang cắt trang/Đang dịch → Xuất.
  await expect(page.getByText("Đã tải xong 1 ảnh")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Dịch chương" }).click();
  const busy = page.getByRole("button", { name: /^Đang (cắt trang|dịch)/ });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();

  let ready = false;
  const worker = runFakeWorker(state.token, () => ready, 60_000, { pagesPerSource: 3 });
  const rail = page.getByRole("complementary", { name: "Danh sách trang" });
  await expect(rail.locator(".status", { hasText: "Xong" })).toHaveCount(3, { timeout: 30_000 });
  const primary = page.getByRole("button", { name: "Xuất", exact: true });
  await expect(primary).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");

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
