/**
 * Đăng ký mở (SIGNUP_ENABLED=true ở API e2e): tài khoản mới vào thẳng home rỗng (không thấy dữ liệu người khác) rồi
 * tạo được series của riêng mình; đăng ký lại cùng email không lộ gì (đăng nhập sai mật khẩu thì báo sai).
 */
import { expect, test } from "@playwright/test";
import { state } from "./helpers.ts";

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
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();
  await expect(page.getByText("Chưa có series nào")).toBeVisible();
  await expect(page.getByText("Series e2e")).toHaveCount(0);

  await page.getByRole("button", { name: "+ Series mới" }).click();
  await page.getByRole("form", { name: "Tạo series mới" }).getByLabel("Tên series").fill("Series của người mới");
  await page.getByRole("button", { name: "Tạo series" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Series của người mới" })).toBeVisible();

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
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Mật khẩu").fill("another-password-1");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page.getByRole("alert")).toHaveText("Sai email hoặc mật khẩu.");
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
});
