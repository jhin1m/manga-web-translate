/** Quyền admin ở web: owner (ADMIN_EMAILS) thấy Cài đặt + mục Pipeline + AI (nhà cung cấp, model tác vụ); người dùng thường không thấy link và bị đưa về `/`. */
import { expect, test } from "@playwright/test";
import { E2E_VICTIM } from "./env.ts";
import { login, state } from "./helpers.ts";

test("admin sees the Settings link and the Pipeline section", async ({ page }) => {
  await login(page);
  await page.getByLabel("Tài khoản", { exact: true }).click();
  await page.getByRole("link", { name: "Cài đặt", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("form", { name: "Cài đặt pipeline" })).toBeVisible();
  // Mục lạ → về mục đầu.
  await page.goto("/settings?section=khong-co");
  await expect(page.getByRole("form", { name: "Cài đặt pipeline" })).toBeVisible();
});

test("a regular user has no Settings link, is redirected from /settings and can use /fonts", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.plain.email);
  await page.getByLabel("Mật khẩu").fill(state.plain.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("region", { name: "Series", exact: true })).toBeVisible();

  await page.getByLabel("Tài khoản", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Font của tôi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cài đặt", exact: true })).toHaveCount(0);

  const denied = await page.request.get("/api/admin/settings");
  expect(denied.status()).toBe(403);

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/fonts");
  await expect(page.getByRole("heading", { name: "Font của tôi" })).toBeVisible();
});

test("admin adds a provider (key shown only as last4), assigns the translate slot and it survives a reload", async ({
  page,
}) => {
  const key = "sk-e2e-fake-key-0000WXYZ";
  await login(page);
  await page.goto("/settings?section=providers");
  await page.getByRole("button", { name: "Thêm nhà cung cấp" }).click();
  const form = page.getByRole("form", { name: "Thêm nhà cung cấp" });
  await form.getByLabel("Tên hiển thị").fill("OpenAI e2e");
  await form.getByLabel("API key").fill(key);
  await form.getByRole("button", { name: "+ gpt-4.1-mini" }).click();
  await form.getByRole("button", { name: "Thêm nhà cung cấp" }).click();

  const table = page.getByRole("table", { name: "Danh sách nhà cung cấp" });
  const row = table.getByRole("row", { name: /OpenAI e2e/ });
  await expect(row).toContainText("••••WXYZ");
  await expect(page.locator("body")).not.toContainText(key);
  await expect(row.getByRole("cell").nth(3)).toHaveText("1");

  await page.getByRole("link", { name: "Model tác vụ" }).click();
  await page.getByLabel("Dịch", { exact: true }).selectOption({ label: "OpenAI e2e · gpt-4.1-mini" });
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu.");

  await page.reload();
  await expect(page.getByLabel("Dịch", { exact: true })).toHaveValue(/.+/);
  await expect(page.getByLabel("Dịch", { exact: true }).locator("option:checked")).toHaveText(
    "OpenAI e2e · gpt-4.1-mini",
  );

  // Xoá bị chặn khi còn gán slot; bỏ gán rồi xoá được.
  await page.getByRole("link", { name: "Nhà cung cấp" }).click();
  await page.getByRole("button", { name: "Xoá OpenAI e2e" }).click();
  await page.getByRole("button", { name: "Xác nhận xoá OpenAI e2e" }).click();
  await expect(page.getByRole("alert")).toContainText("đang được gán");
  await page.getByRole("link", { name: "Model tác vụ" }).click();
  await page.getByLabel("Dịch", { exact: true }).selectOption({ label: "Mặc định (env worker)" });
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu.");
  await page.getByRole("link", { name: "Nhà cung cấp" }).click();
  await page.getByRole("button", { name: "Xoá OpenAI e2e" }).click();
  await page.getByRole("button", { name: "Xác nhận xoá OpenAI e2e" }).click();
  await expect(table.getByRole("row", { name: /OpenAI e2e/ })).toHaveCount(0);
});

test("admin picks the DeepSeek preset: base URL, json_object and price suggestions are filled in", async ({ page }) => {
  await login(page);
  await page.goto("/settings?section=providers");
  await page.getByRole("button", { name: "Thêm nhà cung cấp" }).click();
  const form = page.getByRole("form", { name: "Thêm nhà cung cấp" });
  await form.getByLabel("Loại").selectOption("deepseek");
  await expect(form.getByLabel("Tên hiển thị")).toHaveValue("DeepSeek");
  await expect(form.getByLabel("Base URL")).toHaveValue("https://api.deepseek.com");
  await expect(form.getByLabel("Kiểu JSON")).toHaveValue("json_object");
  await form.getByRole("button", { name: "+ deepseek-flash" }).click();
  await expect(form.getByLabel("Model 1: giá vào")).toHaveValue("0.3");
  await expect(form.getByLabel("Model 1: giá ra")).toHaveValue("1.2");
  await form.getByRole("button", { name: "Huỷ" }).click();
});

test("admin edits the limits: needs both to allow sign-up, confirms before lowering under today's spend", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings?section=limits");
  const form = page.getByRole("form", { name: "Hạn mức và đăng ký" });
  const user = form.getByLabel("Hạn mức mỗi người (USD / ngày UTC)");
  const global = form.getByLabel("Ngân sách ngày toàn hệ thống (USD)");
  await expect(user).toHaveAttribute("placeholder", /env: \$1000/);

  // Gõ số lạ → báo lỗi, không lưu được; số hợp lệ → lưu rồi tải lại vẫn còn.
  await user.fill("abc");
  await expect(form.getByRole("alert")).toContainText("số USD");
  await expect(form.getByRole("button", { name: "Lưu" })).toBeDisabled();
  await user.fill("500");
  await global.fill("2000");
  await form.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu.");
  await page.reload();
  await expect(user).toHaveValue("500");
  await expect(global).toHaveValue("2000");

  // Ngân sách 0 → hạ dưới số đã chi (≥ 0): hỏi xác nhận; Huỷ thì không đổi.
  await global.fill("0");
  await form.getByRole("button", { name: "Lưu" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Xác nhận hạ hạn mức" });
  await expect(dialog).toContainText("paused_budget");
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await page.reload();
  await expect(global).toHaveValue("2000");

  // Trả về theo env (ô trống).
  await user.fill("");
  await global.fill("");
  await form.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu.");
  await page.reload();
  await expect(user).toHaveValue("");
  await expect(global).toHaveValue("");
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
  await victim.getByRole("link", { name: "Font của tôi" }).click();
  await expect(victim.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
  await victim.getByLabel("Email").fill(E2E_VICTIM.email);
  await victim.getByLabel("Mật khẩu").fill(E2E_VICTIM.password);
  await victim.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(victim.getByRole("alert")).toHaveText("Tài khoản đã bị khoá.");

  await page.getByRole("button", { name: `Mở khoá ${E2E_VICTIM.email}` }).click();
  await expect(page.getByRole("button", { name: `Khoá ${E2E_VICTIM.email}` })).toBeVisible();
  await victim.getByRole("button", { name: "Đăng nhập" }).click();
  // Đăng nhập xong về đúng trang đang mở dở.
  await expect(victim.getByRole("heading", { name: "Font của tôi" })).toBeVisible();
  await ctx.close();
});

test("the admin row has no lock button", async ({ page }) => {
  await login(page);
  await page.goto("/settings?section=users");
  const row = page.getByRole("row", { name: new RegExp(state.email) });
  await expect(row).toContainText("Admin");
  await expect(row.getByRole("button")).toHaveCount(0);
});
