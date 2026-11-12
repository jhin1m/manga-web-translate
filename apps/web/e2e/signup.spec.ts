/**
 * Đăng ký mở (SIGNUP_ENABLED=true ở API e2e): tài khoản mới vào thẳng home rỗng (không thấy dữ liệu người khác) rồi
 * tạo được series của riêng mình; đăng ký lại cùng email không lộ gì (đăng nhập sai mật khẩu thì báo sai).
 */
import { expect, test } from "@playwright/test";
import { login, state } from "./helpers.ts";

test("sign up → empty home → create a series", async ({ browser }) => {
  // Context mới, không cookie: /login không qua cổng dev auto-login.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `signup-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page.getByRole("heading", { name: "Đăng ký" })).toBeVisible();
  await page.getByLabel("Tên").fill("Người mới");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill("signup-password-1");
  await page.getByRole("button", { name: "Đăng ký" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("region", { name: "Series", exact: true })).toBeVisible();
  await expect(page.getByText("Chưa có series nào")).toBeVisible();
  await expect(page.getByText("Series e2e")).toHaveCount(0);

  await page.getByRole("button", { name: "+ Series" }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo series mới" });
  // Modal mở → con trỏ ở ô tên; chọn ngôn ngữ ngay khi tạo.
  await expect(dialog.getByLabel("Tên series")).toBeFocused();
  await dialog.getByLabel("Tên series").fill("Series của người mới");
  await dialog.getByLabel("Dịch từ").selectOption("ko");
  await dialog.getByRole("button", { name: "Tạo series" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Series của người mới" })).toBeVisible();
  await expect(page.locator(".series-head").getByText(/Hàn → Việt/)).toBeVisible();

  // Series của người dùng seed không mở được từ tài khoản mới.
  expect((await page.request.get(`/api/series/${state.seriesId}`)).status()).toBe(404);
  await ctx.close();
});

test("signing up with an existing email reveals nothing; the wrong password just fails to sign in", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await page.getByLabel("Email").fill(state.plain.email);
  await page.getByLabel("Mật khẩu").fill("another-password-1");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page.getByRole("alert")).toHaveText("Sai email hoặc mật khẩu.");
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
});

test("admin switches sign-up off on the UI → the form says it is closed at once; on again → sign-up works", async ({
  browser,
  page,
}) => {
  const toggle = async (on: boolean) => {
    await page.goto("/settings?section=limits");
    const box = page.getByLabel("Cho phép đăng ký");
    await expect(box).toBeVisible();
    if ((await box.isChecked()) === on) return;
    await box.setChecked(on);
    await page.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByRole("status")).toHaveText("Đã lưu.");
  };
  const signUp = async (email: string) => {
    // IP riêng: bộ đếm rate limit (sign-up 5/giờ, sign-in 3/10s) không dùng chung với các ca khác trong lượt chạy.
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.77" } });
    const guest = await ctx.newPage();
    await guest.goto("/login");
    await guest.getByRole("button", { name: "Đăng ký" }).click();
    await guest.getByLabel("Tên").fill("Người mới");
    await guest.getByLabel("Email").fill(email);
    await guest.getByLabel("Mật khẩu").fill("signup-password-1");
    await guest.getByRole("button", { name: "Đăng ký" }).click();
    return { guest, ctx };
  };

  await login(page);
  try {
    await toggle(false);
    const closed = await signUp(`signup-off-${Date.now()}@example.com`);
    await expect(closed.guest.getByRole("alert")).toHaveText("Hiện chưa mở đăng ký.");
    await closed.ctx.close();

    await toggle(true);
    const open = await signUp(`signup-on-${Date.now()}@example.com`);
    await expect(open.guest).toHaveURL(/\/$/);
    await open.ctx.close();
  } finally {
    await toggle(true);
  }
});
