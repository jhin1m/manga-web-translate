/**
 * Cắt mép ảnh gốc trước "Dịch chương": menu chuột phải thumbnail → "Cắt mép ảnh n…" → kéo thanh bằng chuột / phím →
 * Enter (Xong) / Esc (Huỷ); trim giữ sau khi tải lại, "Bỏ cắt" + Hoàn tác; sau "Dịch chương" trang cuối cao đúng
 * phần ảnh còn lại (worker giả tính theo trim trong inputs).
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { runFakeWorker } from "./fake-worker.ts";
import { grayPng } from "./gray-png.ts";
import { login, state } from "./helpers.ts";

const H = 300;
const BOTTOM = 53;

/** Series tạo trong test; dọn cả khi test lỗi để không làm đổi series tự đoán ở các test thả file sau. */
let sid: string | null = null;

test.afterEach(async ({ page }) => {
  if (!sid) return;
  const id = sid;
  sid = null;
  await page.request.delete(`/api/series/${id}`, { headers: { origin: WEB_URL } });
});

test("trim the bottom edge of the last image, keep it across reload, then translate with the trimmed height", async ({
  page,
}) => {
  await login(page);
  const created = await page.request.post(`/api/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series cắt mép e2e" },
  });
  expect(created.status()).toBe(201);
  sid = ((await created.json()) as { id: string }).id;

  await page.goto(`/s/${sid}`);
  await page
    .getByRole("region", { name: "Thêm chương tiếp theo" })
    .locator('input[type="file"]')
    .setInputFiles([
      { name: "p1.png", mimeType: "image/png", buffer: grayPng(120, H, (x) => x * 2) },
      { name: "p2.png", mimeType: "image/png", buffer: grayPng(120, H, (x, y) => x + y) },
    ]);
  await expect(page).toHaveURL(new RegExp(`/s/${sid}/c/[0-9a-f-]{36}$`), { timeout: 30_000 });
  const chapterId = page.url().split("/").pop() ?? "";
  const step1 = page.getByRole("button", { name: "Dịch chương", exact: true });
  await expect(step1).toBeEnabled({ timeout: 30_000 });

  const sources = page.getByRole("complementary", { name: "Danh sách ảnh gốc" });
  const thumb2 = sources.getByRole("button", { name: /^Ảnh 2/ });
  const openTrim = async () => {
    await thumb2.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Cắt mép ảnh 2…" }).click();
  };
  const top = page.getByRole("slider", { name: "Mép trên" });
  const bottom = page.getByRole("slider", { name: "Mép dưới" });
  const trimmedOnServer = async () => {
    const res = await page.request.get(`/api/chapters/${chapterId}`);
    const body = (await res.json()) as {
      source_files: { ord: number; trim: { top: number; bottom: number } | null }[];
    };
    return [...body.source_files].sort((a, b) => a.ord - b.ord).map((f) => f.trim && [f.trim.top, f.trim.bottom]);
  };

  // Ảnh chưa cắt: menu không có "Bỏ cắt"; không có thanh kéo ngoài chế độ cắt.
  await thumb2.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Bỏ cắt" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(top).toHaveCount(0);

  // Chuột: kéo thanh trên xuống rồi Esc → không lưu gì, focus về thumbnail.
  await openTrim();
  await expect(page.getByRole("img", { name: "Ảnh gốc 2" })).toBeVisible();
  await expect(top).toBeFocused();
  await expect(page.getByRole("button", { name: "Ảnh trước" })).toHaveCount(0);
  const box = await top.boundingBox();
  if (!box) throw new Error("top handle has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 42, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText(/Trên [1-9]\d* px · Dưới 0 px/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(top).toHaveCount(0);
  await expect(thumb2).toBeFocused();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2");
  expect(await trimmedOnServer()).toEqual([null, null]);

  // Bàn phím: thanh dưới ↑ 1 px, Shift+↑ 10 px; kẹp ở mép trên ảnh còn lại ≥ MIN_TRIM_KEEP_PX; Enter = Xong.
  await openTrim();
  // Kéo thanh trên quá xa → kẹp, ảnh còn lại đúng 64 px (MIN_TRIM_KEEP_PX); rồi về 0.
  for (let i = 0; i < 30; i++) await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByText(`Trên ${H - 64} px · Dưới 0 px`)).toBeVisible();
  for (let i = 0; i < 30; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByText("Trên 0 px · Dưới 0 px")).toBeVisible();
  await bottom.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowUp");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await expect(page.getByText(`Trên 0 px · Dưới ${BOTTOM} px`)).toBeVisible();
  await expect(bottom).toHaveAttribute("aria-valuenow", String(H - BOTTOM));
  await page.keyboard.press("Enter");
  await expect(bottom).toHaveCount(0);
  await expect(thumb2).toBeFocused();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");
  await expect(page.getByRole("status").filter({ hasText: "Đã cắt mép ảnh 2" })).toBeVisible();
  await expect(page.getByText("Phần mờ bị bỏ khi cắt trang")).toBeVisible();
  await expect.poll(trimmedOnServer).toEqual([null, [0, BOTTOM]]);

  await page.reload();
  await expect(sources.locator("img")).toHaveCount(2);
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");

  // Bỏ cắt → Hoàn tác trả đúng trim trước đó.
  await thumb2.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bỏ cắt" }).click();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2");
  await expect.poll(trimmedOnServer).toEqual([null, null]);
  await page
    .getByRole("status")
    .filter({ hasText: "Đã bỏ cắt ảnh 2" })
    .getByRole("button", { name: "Hoàn tác" })
    .click();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");
  await expect.poll(trimmedOnServer).toEqual([null, [0, BOTTOM]]);

  // Dịch chương: trang cuối cao H − bottom, trang đầu giữ nguyên.
  let ready = false;
  const worker = runFakeWorker(state.token, () => ready, 60_000);
  await expect(step1).toBeEnabled();
  await step1.click();
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/chapters/${chapterId}/pages`);
        const body = (await res.json()) as { pages: { ord: number; height: number }[] };
        return [...body.pages].sort((a, b) => a.ord - b.ord).map((p) => p.height);
      },
      { timeout: 30_000 },
    )
    .toEqual([1000, H - BOTTOM]);
  ready = true;
  await worker;
});
