/**
 * Luồng chính: thả ZIP 10 trang ở home → dòng xác nhận → "Tạo và mở chương" mở thẳng màn chương trong khi ảnh
 * còn đang upload → upload xong → "Dịch chương" → worker giả → 10 trang "Xong" trên rail. Thêm: màn series (3 ảnh lẻ
 * = 3 chương liên tiếp, glossary thêm nhanh), drawer Hoạt động ở home khi đang upload. Test đầu đăng nhập bằng form
 * `/login` (các spec khác dùng dev auto-login).
 */
import { expect, type Route, test } from "@playwright/test";
import { zipSync } from "fflate";
import { WEB_URL } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import { login, loginWithForm, state } from "./helpers.ts";

const ws = state.workspaceId;
const s = state.seriesId;

test("drop a 10-page ZIP on home, open the chapter while uploading, then translate", async ({ page }) => {
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
    .setInputFiles({ name: "chuong-1.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });

  const confirm = page.getByRole("form", { name: "Sau khi thả file" });
  await expect(confirm.getByText("chuong-1.zip · 10 ảnh")).toBeVisible();
  await confirm.getByLabel("Series (đoán từ tên file)").selectOption({ label: "Series e2e" });
  await expect(confirm.getByLabel("Chương số")).toHaveValue("1");
  await confirm.getByLabel("Chương số").fill("501");
  await confirm.getByRole("button", { name: "Tạo và mở chương" }).click();

  await expect(page).toHaveURL(/\/w\/.+\/s\/.+\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /^Chương 501/ })).toBeVisible();
  await expect(page.getByRole("status", { name: "Tiến độ tải ảnh" })).toContainText("Đang tải ảnh");
  await expect(page.getByRole("button", { name: "Dịch chương" })).toBeDisabled();
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

  await expect(page.getByText("Đã tải xong 10 ảnh")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Dịch chương" }).click();

  let ready = false;
  const worker = runFakeWorker(state.token, () => ready);
  await expect(page.getByRole("status", { name: "Trạng thái chương" })).toHaveText(/^Chờ duyệt/, { timeout: 30_000 });
  ready = true;
  await worker;
  const rail = page.getByRole("complementary", { name: "Danh sách trang" });
  await expect(rail.locator(".status", { hasText: "Xong" })).toHaveCount(10);
  // Thumbnail là ảnh sạch ký qua FILES_DOMAIN.
  await expect(rail.locator("img").first()).toHaveAttribute("src", /localhost:9100\/.*\/clean\//);

  // Home: chương vừa dịch nằm trong "Việc cần làm" với bước tiếp theo "Tiếp tục sửa".
  await page.getByRole("link", { name: "Series e2e" }).click();
  await page.getByRole("link", { name: "MTL" }).click();
  const todo = page.getByRole("region", { name: "Việc cần làm" });
  await expect(
    todo.locator(".row-item", { hasText: "Chương 501" }).getByRole("link", { name: "Tiếp tục sửa" }),
  ).toBeVisible();
});

test("series page: 3 loose images become 3 consecutive chapters; quick glossary add shows up", async ({ page }) => {
  await login(page);
  await page.goto(`/w/${ws}/s/${s}`);
  const zone = page.getByRole("region", { name: "Thêm chương tiếp theo" });
  const next = Number((await zone.getByText(/^Thả strip của Chương \d+/).textContent())?.match(/\d+/)?.[0]);
  expect(next).toBeGreaterThan(0);
  await zone
    .locator('input[type="file"]')
    .setInputFiles(["p1.png", "p2.png", "p3.png"].map((name) => ({ name, mimeType: "image/png", buffer: PNG_1PX })));
  const confirm = page.getByRole("form", { name: "Sau khi thả file" });
  await expect(confirm.getByLabel("1 chương gồm 3 ảnh")).toBeChecked();
  await confirm.getByLabel("3 chương, mỗi ảnh 1 chương").check();
  await confirm.getByRole("button", { name: "Tạo 3 chương" }).click();
  await expect(confirm).toBeHidden();
  for (const n of [next, next + 1, next + 2]) {
    await expect(
      page.locator(".row-item", { hasText: `Ch.${n}` }).getByRole("button", { name: "Dịch chương" }),
    ).toBeVisible({
      timeout: 15_000,
    });
  }

  const glossary = page.getByRole("region", { name: "Glossary của series" });
  await glossary.getByLabel("Từ gốc").fill("김준");
  await glossary.getByLabel("Bản dịch").fill("Kim Jun");
  await glossary.getByRole("button", { name: "Thêm" }).click();
  await expect(glossary.getByRole("cell", { name: "Kim Jun" })).toBeVisible();
});
