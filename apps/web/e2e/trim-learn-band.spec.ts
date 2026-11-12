/**
 * "Luôn cắt ở series này": sau khi cắt mép (ảnh đọc lại từ URL ký sau khi tải lại trang), toast học dải đã cắt →
 * hiện trong Cài đặt series ở "Ảnh tự bỏ" với nhãn "Dải cuối ảnh"; học lại báo đã có; xoá khỏi danh sách.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { grayPng } from "./gray-png.ts";
import { login } from "./helpers.ts";

const H = 300;
const BAND = 50;
/** Sọc dọc xen kẽ → dHash có nhiều bit 1, không bị coi là ảnh trơn. */
const stripes = (x: number) => (Math.floor(x / 13) % 2 ? 30 : 220);

/** Series tạo trong test; dọn cả khi test lỗi để không làm đổi series tự đoán ở các test thả file sau. */
let sid: string | null = null;

test.afterEach(async ({ page }) => {
  if (!sid) return;
  const id = sid;
  sid = null;
  await page.request.delete(`/api/series/${id}`, { headers: { origin: WEB_URL } });
});

test("learn the trimmed bottom band, see it in the series settings, learning twice says it already exists", async ({
  page,
}) => {
  await login(page);
  const created = await page.request.post(`/api/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series học dải e2e" },
  });
  expect(created.status()).toBe(201);
  sid = ((await created.json()) as { id: string }).id;

  await page.goto(`/s/${sid}`);
  await page
    .getByRole("region", { name: "Thêm chương tiếp theo" })
    .locator('input[type="file"]')
    .setInputFiles([
      { name: "p1.png", mimeType: "image/png", buffer: grayPng(120, H, stripes) },
      { name: "p2.png", mimeType: "image/png", buffer: grayPng(120, H, stripes) },
    ]);
  await expect(page).toHaveURL(new RegExp(`/s/${sid}/c/[0-9a-f-]{36}$`), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Dịch chương", exact: true })).toBeEnabled({ timeout: 30_000 });
  // Tải lại: rail dùng URL ký của storage, không còn blob local.
  await page.reload();
  const sources = page.getByRole("complementary", { name: "Danh sách ảnh gốc" });
  const thumb2 = sources.getByRole("button", { name: /^Ảnh 2/ });
  await expect(sources.locator("img")).toHaveCount(2);

  await thumb2.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cắt mép ảnh 2…" }).click();
  await page.getByRole("slider", { name: "Mép dưới" }).focus();
  for (let i = 0; i < BAND / 10; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByText(`Trên 0 px · Dưới ${BAND} px`)).toBeVisible();
  await page.keyboard.press("Enter");

  const toast = page.getByRole("status").filter({ hasText: "Đã cắt mép ảnh 2" });
  await toast.getByRole("button", { name: "Luôn cắt ở series này" }).click();
  await expect(page.getByText("Đã học 1 dải")).toBeVisible();

  // Cắt lại đúng như vậy → học lần nữa: đã có sẵn.
  await thumb2.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bỏ cắt" }).click();
  await thumb2.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cắt mép ảnh 2…" }).click();
  await page.getByRole("slider", { name: "Mép dưới" }).focus();
  for (let i = 0; i < BAND / 10; i++) await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Enter");
  await page
    .getByRole("status")
    .filter({ hasText: "Đã cắt mép ảnh 2" })
    .getByRole("button", { name: "Luôn cắt ở series này" })
    .click();
  await expect(page.getByText(/Đã có sẵn 1 dải/)).toBeVisible();

  await page.goto(`/s/${sid}?tab=settings`);
  await page.getByRole("dialog", { name: "Cài đặt dịch" }).getByText("Ảnh tự bỏ", { exact: true }).click();
  const learned = page.getByRole("group", { name: "Ảnh tự bỏ" });
  await expect(learned.getByRole("img", { name: "Dải cuối ảnh" })).toBeVisible();
  await expect(learned.getByRole("listitem")).toHaveCount(1);
  await learned.getByRole("button", { name: /^Xoá dải cuối ảnh/ }).click();
  await expect(learned.getByText("Chưa có ảnh nào.")).toBeVisible();
});
