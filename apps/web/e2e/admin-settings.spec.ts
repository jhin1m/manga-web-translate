/**
 * Quyền ở trang Cài đặt: owner (ADMIN_EMAILS) thấy mục Font + Pipeline (kèm model AI từng bước) + Nhà cung cấp + Người
 * dùng; người dùng thường vẫn có link Cài đặt nhưng chỉ thấy mục Font (mục admin trên URL rơi về Font).
 */
import { expect, test } from "@playwright/test";
import { E2E_VICTIM } from "./env.ts";
import { login, state } from "./helpers.ts";

test("admin sees the Settings link, Font first, then the Pipeline section", async ({ page }) => {
  await login(page);
  await page.getByLabel("Tài khoản", { exact: true }).click();
  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Mục cài đặt" });
  await expect(nav.getByRole("link", { name: "Font", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Hạn mức & đăng ký" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Pipeline" }).click();
  await expect(page.getByRole("form", { name: "Cài đặt pipeline" })).toBeVisible();
  // Mục lạ / mục đã bỏ → về mục đầu (Font).
  await page.goto("/settings?section=limits");
  await expect(page.getByRole("heading", { name: "Thêm font" })).toBeVisible();
});

test("a regular user only sees the Font section of Settings; /fonts redirects there", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.plain.email);
  await page.getByLabel("Mật khẩu").fill(state.plain.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("region", { name: "Series", exact: true })).toBeVisible();

  await page.getByLabel("Tài khoản", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Font", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();

  const denied = await page.request.get("/api/admin/settings");
  expect(denied.status()).toBe(403);

  const nav = page.getByRole("navigation", { name: "Mục cài đặt" });
  await expect(nav.getByRole("link")).toHaveText(["Font"]);
  await expect(page.getByRole("heading", { name: "Thêm font" })).toBeVisible();
  // Mục admin trên URL → vẫn là mục Font.
  await page.goto("/settings?section=pipeline");
  await expect(page.getByRole("heading", { name: "Thêm font" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Cài đặt pipeline" })).toHaveCount(0);
  // Link cũ.
  await page.goto("/fonts");
  await expect(page).toHaveURL(/\/settings\?section=fonts$/);
  await expect(nav.getByRole("link", { name: "Font", exact: true })).toHaveAttribute("aria-current", "page");
});

test("admin adds a provider (key shown only as last4), assigns the translate slot and it survives a reload", async ({
  page,
}) => {
  const key = "sk-e2e-fake-key-0000WXYZ";
  await login(page);
  await page.goto("/settings?section=providers");
  await page.getByRole("button", { name: "Thêm nhà cung cấp" }).click();
  const form = page.getByRole("form", { name: "Thêm nhà cung cấp" });
  // Chỉ cần chọn nhà cung cấp + dán key: model gợi ý (kèm giá) điền sẵn. Đổi tên ở mục Tuỳ chỉnh cho khỏi trùng spec khác.
  await form.getByRole("radio", { name: "OpenAI", exact: true }).check();
  await form.getByLabel("API key").fill(key);
  await form.getByText("Tuỳ chỉnh tên, model và giá").click();
  await expect(form.getByLabel("Model 1: id")).toHaveValue("gpt-4.1-mini");
  await form.getByLabel("Tên hiển thị").fill("OpenAI e2e");
  await form.getByRole("button", { name: "Thêm nhà cung cấp" }).click();

  const list = page.getByRole("list", { name: "Danh sách nhà cung cấp" });
  const item = list.getByRole("listitem", { name: "OpenAI e2e" });
  await expect(item).toContainText("••••WXYZ");
  await expect(page.locator("body")).not.toContainText(key);
  await expect(item.getByRole("list", { name: "Model của OpenAI e2e" }).getByRole("listitem")).toHaveText([
    /gpt-4\.1-mini/,
  ]);

  // Model AI của bước Dịch nằm trong Pipeline; đổi là tự lưu.
  await page.getByRole("link", { name: "Pipeline" }).click();
  const translate = page.getByRole("region", { name: "Dịch" }).getByLabel("Model AI");
  await translate.selectOption({ label: "gpt-4.1-mini" });
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu" })).toBeVisible();

  await page.reload();
  await expect(translate).toHaveValue(/.+/);
  await expect(translate.locator("option:checked")).toHaveText("gpt-4.1-mini");

  // Xoá bị chặn khi model còn dùng cho một bước; đổi về worker rồi xoá được.
  await page.getByRole("link", { name: "Nhà cung cấp" }).click();
  await page.getByRole("button", { name: "Xoá OpenAI e2e" }).click();
  await page.getByRole("button", { name: "Xác nhận xoá OpenAI e2e" }).click();
  await expect(page.getByRole("alert")).toContainText("đang được dùng cho bước Dịch");
  await page.getByRole("link", { name: "Pipeline" }).click();
  await translate.selectOption({ label: "Theo worker (.env)" });
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu" })).toBeVisible();
  await page.getByRole("link", { name: "Nhà cung cấp" }).click();
  await page.getByRole("button", { name: "Xoá OpenAI e2e" }).click();
  await page.getByRole("button", { name: "Xác nhận xoá OpenAI e2e" }).click();
  await expect(list.getByRole("listitem", { name: "OpenAI e2e" })).toHaveCount(0);
});

test("admin picks the DeepSeek preset: base URL, json_object and price suggestions are filled in", async ({ page }) => {
  await login(page);
  await page.goto("/settings?section=providers");
  await page.getByRole("button", { name: "Thêm nhà cung cấp" }).click();
  const form = page.getByRole("form", { name: "Thêm nhà cung cấp" });
  await form.getByRole("radio", { name: "DeepSeek" }).check();
  // Thu gọn: chỉ ô key; mục Tuỳ chỉnh tóm tắt sẵn tên + model.
  await expect(form.getByLabel("Base URL")).toBeHidden();
  await expect(form.getByText("DeepSeek · deepseek-flash")).toBeVisible();
  await form.getByText("Tuỳ chỉnh tên, model và giá").click();
  await expect(form.getByLabel("Tên hiển thị")).toHaveValue("DeepSeek");
  await expect(form.getByLabel("Base URL")).toHaveValue("https://api.deepseek.com");
  await expect(form.getByLabel("Kiểu JSON")).toHaveValue("json_object");
  await expect(form.getByLabel("Model 1: id")).toHaveValue("deepseek-flash");
  await expect(form.getByLabel("Model 1: giá vào")).toHaveValue("0.3");
  await expect(form.getByLabel("Model 1: giá ra")).toHaveValue("1.2");
  await form.getByRole("button", { name: "+ deepseek-v4-pro" }).click();
  await expect(form.getByLabel("Model 2: giá vào")).toHaveValue("1.32");
  // Endpoint tuỳ chỉnh: không có gợi ý → base URL hiện ngay, mục Tuỳ chỉnh mở sẵn, tên / model để trống.
  await form.getByRole("radio", { name: "Khác (tương thích OpenAI)" }).check();
  await expect(form.getByLabel("Base URL")).toHaveValue("");
  await expect(form.getByLabel("Tên hiển thị")).toHaveValue("");
  await expect(form.getByLabel("Model 1: id")).toHaveCount(0);
  await form.getByRole("button", { name: "Huỷ" }).click();
});

test("admin disables a user: their open tab falls back to login at the next action, sign-in says locked, enabling lets them back", async ({
  page,
  browser,
}) => {
  // IP riêng: sign-in giới hạn 3 lần / 10s theo IP, không dùng chung bộ đếm với spec khác.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.88" } });
  const victim = await ctx.newPage();
  await victim.goto("/login");
  await victim.getByLabel("Email").fill(E2E_VICTIM.email);
  await victim.getByLabel("Mật khẩu").fill(E2E_VICTIM.password);
  await victim.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(victim.getByRole("region", { name: "Series", exact: true })).toBeVisible();

  await login(page);
  await page.goto("/settings?section=users");
  await page.getByLabel("Tìm người dùng").fill(E2E_VICTIM.email);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: `Khoá ${E2E_VICTIM.email}` }).click();
  await expect(page.getByRole("button", { name: `Mở khoá ${E2E_VICTIM.email}` })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(E2E_VICTIM.email) })).toContainText("Đã khoá");

  // Thao tác kế (điều hướng trong app, không reload) → 401 → màn đăng nhập ngay.
  await victim.getByLabel("Tài khoản", { exact: true }).click();
  await victim.getByRole("link", { name: "Cài đặt", exact: true }).click();
  await expect(victim.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
  await victim.getByLabel("Email").fill(E2E_VICTIM.email);
  await victim.getByLabel("Mật khẩu").fill(E2E_VICTIM.password);
  await victim.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(victim.getByRole("alert")).toHaveText("Tài khoản đã bị khoá.");

  await page.getByRole("button", { name: `Mở khoá ${E2E_VICTIM.email}` }).click();
  await expect(page.getByRole("button", { name: `Khoá ${E2E_VICTIM.email}` })).toBeVisible();
  await victim.getByRole("button", { name: "Đăng nhập" }).click();
  // Đăng nhập xong về đúng trang đang mở dở.
  await expect(victim.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
  await ctx.close();
});

test("the admin row has no lock button", async ({ page }) => {
  await login(page);
  await page.goto("/settings?section=users");
  const row = page.getByRole("row", { name: new RegExp(state.email) });
  await expect(row).toContainText("Admin");
  await expect(row.getByRole("button")).toHaveCount(0);
});
