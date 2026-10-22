/**
 * Luồng chính: thả ZIP 10 trang ở home → mở thẳng màn chương (series duy nhất, số chương từ tên ZIP) trong khi ảnh
 * còn đang upload → upload xong bấm "Bước 1" → worker giả → "Bước 2 · Dịch" → 10 trang "Xong" trên rail. Thêm: drawer
 * Hoạt động ở home khi đang upload; màn series (3 ảnh lẻ = 1 chương nháp số kế tiếp) + đổi số chương / series trên thanh trên +
 * glossary thêm nhanh; file lỗi → dòng xác nhận cũ báo lỗi. Test đầu đăng nhập bằng form `/login` (các spec khác
 * dùng dev auto-login).
 */
import { expect, type Route, test } from "@playwright/test";
import { zipSync } from "fflate";
import { WEB_URL } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import { login, loginWithForm, state } from "./helpers.ts";

const ws = state.workspaceId;
const s = state.seriesId;

test("drop a 10-page ZIP on home, open the chapter while uploading, then Bước 1 → Bước 2 translate it", async ({
  page,
}) => {
  const names = ["10.png", "2.png", "1.png", "9.png", "3.png", "8.png", "4.png", "7.png", "5.png", "6.png"];
  const zip = zipSync(
    Object.fromEntries([
      ...names.map((n) => [`chuong-1/${n}`, new Uint8Array(PNG_1PX)]),
      ["__MACOSX/chuong-1/._1.png", new Uint8Array([0])],
    ]),
  );

  // Giữ mọi POST lên storage (presigned) tới khi đã ở màn chương → chứng minh điều hướng xảy ra trước khi upload xong.
  const held: Route[] = [];
  let hold = true;
  await page.route(
    (url) => !url.href.startsWith(WEB_URL),
    (route) => {
      if (hold && route.request().method() === "POST") held.push(route);
      else void route.continue();
    },
  );

  await loginWithForm(page);
  await page
    .getByRole("region", { name: "Tạo chương mới" })
    .locator('input[type="file"]')
    .setInputFiles({ name: "chuong-501.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });

  // Không có dòng xác nhận: workspace chỉ có 1 series, số chương lấy từ tên ZIP.
  await expect(page).toHaveURL(/\/w\/.+\/s\/.+\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /^Chương 501/ })).toBeVisible();
  await expect(page.getByRole("status", { name: "Tiến độ tải ảnh" })).toContainText("Đang tải ảnh");
  await expect(page.getByRole("button", { name: "Bước 1 · Xoá chữ + OCR" })).toBeDisabled();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  // Chưa file nào lên storage nhưng ảnh xem trước đã hiện từ file local, đúng thứ tự tên tự nhiên.
  const preview = page.getByRole("list", { name: "Ảnh gốc đã tải" });
  await expect(preview.locator("img")).toHaveCount(10);
  await expect(preview.locator("img").first()).toHaveAttribute("src", /^blob:/);
  await expect(preview.locator("img").first()).toHaveAttribute("alt", "Ảnh gốc 1");

  // Rời về home khi còn đang tải: drawer Hoạt động liệt kê chương đang upload kèm tiến độ → quay lại chương.
  await page.getByRole("link", { name: "Series e2e" }).click();
  await page.getByRole("link", { name: "MTL" }).click();
  await page.getByRole("button", { name: /^Hoạt động/ }).click();
  const activity = page.getByRole("dialog", { name: "Hoạt động" });
  const item = activity.locator(".drawer-item", { hasText: "Chương 501" });
  await expect(item).toContainText(/Đang tải \d+\/10 ảnh/);
  await expect(item.getByRole("progressbar")).toBeVisible();
  await item.getByRole("link", { name: /Chương 501/ }).click();
  await expect(page.getByRole("heading", { name: /^Chương 501/ })).toBeVisible();

  hold = false;
  for (const r of held.splice(0)) await r.continue();

  // Upload xong → bấm Bước 1 → xong bước 1 chờ bấm Bước 2.
  const step1 = page.getByRole("button", { name: "Bước 1 · Xoá chữ + OCR" });
  await expect(step1).toBeEnabled({ timeout: 30_000 });
  await step1.click();

  let ready = false;
  const worker = runFakeWorker(state.token, () => ready);
  await expect(page.getByRole("status", { name: "Trạng thái chương" })).toHaveText(/chờ dịch$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Bước 2 · Dịch" }).click();
  await expect(page.getByRole("status", { name: "Trạng thái chương" })).toHaveText(/^Chờ duyệt/, { timeout: 30_000 });
  ready = true;
  await worker;
  const rail = page.getByRole("complementary", { name: "Danh sách trang" });
  await expect(rail.locator(".status", { hasText: "Xong" })).toHaveCount(10);
  // Thumbnail là ảnh sạch ký qua FILES_DOMAIN.
  await expect(rail.locator("img").first()).toHaveAttribute("src", /localhost:9100\/.*\/clean\//);

  // Màn series: hàng chương vừa dịch báo "Chờ sửa", icon Sửa mở lại màn chương.
  await page.getByRole("link", { name: "Series e2e" }).click();
  await expect(page.getByRole("link", { name: "Mở chương 501", exact: true })).toContainText("Chờ sửa");
  await page.getByRole("link", { name: "Sửa chương 501", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Chương 501/ })).toBeVisible();
});

test("series page: 3 loose images = 1 draft chapter waiting for Bước 1; fix its number/series in the header", async ({
  page,
}) => {
  await login(page);
  // Series thứ 2 để chuyển chương sang (series đích phải cùng workspace).
  const other = await page.request.post(`/api/w/${ws}/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series phụ e2e" },
  });
  expect(other.status()).toBe(201);
  const otherId = ((await other.json()) as { id: string }).id;

  await page.goto(`/w/${ws}/s/${s}`);
  const zone = page.getByRole("region", { name: "Thêm chương tiếp theo" });
  const next = Number((await zone.getByText(/^Thả strip của Chương \d+/).textContent())?.match(/\d+/)?.[0]);
  expect(next).toBeGreaterThan(0);
  await zone
    .locator('input[type="file"]')
    .setInputFiles(["p1.png", "p2.png", "p3.png"].map((name) => ({ name, mimeType: "image/png", buffer: PNG_1PX })));
  // Ảnh lẻ 1 chương, số kế tiếp (tên ảnh là số trang) → mở thẳng màn chương; tải xong vẫn nháp, chờ Bước 1.
  await expect(page).toHaveURL(new RegExp(`/s/${s}/c/[0-9a-f-]{36}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: new RegExp(`^Chương ${next}$`) })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bước 1 · Xoá chữ + OCR" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("status", { name: "Trạng thái chương" })).toHaveText("Nháp");

  // Số trùng chương có sẵn → báo lỗi, không đổi; số mới + series khác → URL theo series mới.
  const title = page.getByRole("button", { name: `Chương ${next}`, exact: true });
  await title.click();
  const pop = page.getByRole("dialog", { name: "Đổi series / số chương" });
  await pop.getByLabel("Chương số").fill("501");
  await pop.getByRole("button", { name: "Lưu" }).click();
  await expect(pop.getByText("series đã có chương 501")).toBeVisible();
  await pop.getByLabel("Chương số").fill(String(next + 1000));
  await pop.getByLabel("Series").selectOption({ label: "Series phụ e2e" });
  await pop.getByRole("button", { name: "Lưu" }).click();
  await expect(pop).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/s/${otherId}/c/[0-9a-f-]{36}`));
  await expect(page.getByRole("heading", { name: new RegExp(`^Chương ${next + 1000}$`) })).toBeVisible();
  await expect(page.locator(".cw-back")).toHaveText("Series phụ e2e");

  await page.goto(`/w/${ws}/s/${s}`);
  const glossary = page.getByRole("region", { name: "Glossary của series" });
  await glossary.getByLabel("Từ gốc").fill("김준");
  await glossary.getByLabel("Bản dịch").fill("Kim Jun");
  await glossary.getByRole("button", { name: "Thêm" }).click();
  await expect(glossary.getByRole("cell", { name: "Kim Jun" })).toBeVisible();
});

test("files the app cannot take as-is fall back to the confirm row with the problem", async ({ page }) => {
  await login(page);
  await page
    .getByRole("region", { name: "Tạo chương mới" })
    .locator('input[type="file"]')
    .setInputFiles({ name: "bia.gif", mimeType: "image/gif", buffer: PNG_1PX });
  const confirm = page.getByRole("form", { name: "Sau khi thả file" });
  await expect(confirm.getByText("1 file không hợp lệ — bỏ chúng trước khi upload.")).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Tạo và mở chương" })).toBeDisabled();
  await expect(page).toHaveURL(/\/$/);
});
