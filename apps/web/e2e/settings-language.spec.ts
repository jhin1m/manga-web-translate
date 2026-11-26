/**
 * Ngôn ngữ giao diện: ô chọn ở cột trái trang Cài đặt (mọi mục, mọi người dùng). Đổi là áp ngay không reload, nhớ qua
 * reload, `<html lang>` theo ngôn ngữ đang dùng; trình duyệt tiếng Anh chưa chọn gì thì tự vào English. Lựa chọn được
 * lưu lên server (`PUT /api/me/locale`) để ghi chú AI viết theo nó; series mới mặc định dịch sang ngôn ngữ giao diện.
 */
import { expect, type Page, test } from "@playwright/test";
import { login } from "./helpers.ts";

/** Chờ web lưu ngôn ngữ giao diện lên server với đúng mã. */
const savedLocale = (page: Page, code: string) =>
  page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/me/locale") &&
      r.request().method() === "PUT" &&
      r.request().postDataJSON()?.ui_locale === code &&
      r.ok(),
  );

test("switching the interface language to English applies at once, survives a reload and sets <html lang>", async ({
  page,
}) => {
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await page.goto("/settings?section=pipeline");
  const picker = page.getByLabel("Ngôn ngữ giao diện");
  await expect(picker).toHaveValue("vi");
  // Đánh dấu trang để chứng minh không reload.
  await page.evaluate(() => Object.assign(window, { __noReload: true }));

  const savedEn = savedLocale(page, "en");
  await picker.selectOption({ label: "English" });
  await savedEn;
  const english = page.getByLabel("Interface language");
  await expect(english).toHaveValue("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => "__noReload" in window)).toBe(true);

  await page.reload();
  await expect(english).toHaveValue("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const savedVi = savedLocale(page, "vi");
  await english.selectOption({ label: "Tiếng Việt" });
  await savedVi;
  await expect(page.getByLabel("Ngôn ngữ giao diện")).toHaveValue("vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
});

test.describe("English browser", () => {
  test.use({ locale: "en-US" });

  test("an English browser without a saved choice opens in English", async ({ page }) => {
    await login(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto("/settings");
    await expect(page.getByLabel("Interface language")).toHaveValue("en");
  });

  test("a new series defaults to translating into the interface language", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await page.getByRole("button", { name: "+ Series" }).click();
    const form = page.getByRole("dialog", { name: "New series" });
    await expect(form.getByLabel("To", { exact: true })).toHaveValue("en");
  });
});
