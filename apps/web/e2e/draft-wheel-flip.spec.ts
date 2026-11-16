/**
 * Màn nháp (chương chưa có page): cuộn quá mép dưới / trên của ảnh gốc = sang ảnh sau / trước như editor. Cuộn xuống
 * vào đầu ảnh sau, quán tính ngay sau đó bị nuốt (không lật tiếp, không cuộn ảnh mới); cuộn lên vào cuối ảnh trước;
 * ảnh đầu / cuối đứng yên; đang mở panel Cắt mép thì cuộn không đổi ảnh; đang zoom, ảnh rộng hơn khung vào ở giữa ngang.
 */
import { expect, type Locator, test } from "@playwright/test";
import { FLIP_COOLDOWN_MS, FLIP_PAUSE_MS } from "../src/features/editor/wheel-page-flip.ts";
import { WEB_URL } from "./env.ts";
import { grayPng } from "./gray-png.ts";
import { login } from "./helpers.ts";

/** Ảnh cao hơn khung (1080px) để còn chỗ cuộn trong ảnh. */
const H = 2400;
/** Ngắt đủ để wheel sau là cử chỉ mới / hết khoá sau lần đổi ảnh. */
const PAUSE = FLIP_PAUSE_MS + 100;
const COOLDOWN = FLIP_COOLDOWN_MS + 100;

let sid: string | null = null;

test.afterEach(async ({ page }) => {
  if (!sid) return;
  const id = sid;
  sid = null;
  await page.request.delete(`/api/series/${id}`, { headers: { origin: WEB_URL } });
});

const scrollState = (view: Locator) =>
  view.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));

test("scrolling past an image edge in the draft viewer moves to the next or previous image", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series cuộn đổi ảnh e2e" },
  });
  expect(created.status()).toBe(201);
  sid = ((await created.json()) as { id: string }).id;

  await page.goto(`/s/${sid}`);
  await page
    .getByRole("region", { name: "Thêm chương tiếp theo" })
    .locator('input[type="file"]:not([webkitdirectory])')
    .setInputFiles([
      { name: "p1.png", mimeType: "image/png", buffer: grayPng(120, H, (x, y) => (x + y) % 256) },
      { name: "p2.png", mimeType: "image/png", buffer: grayPng(120, H, (x, y) => (x * 2 + y / 3) % 256) },
      { name: "p3.png", mimeType: "image/png", buffer: grayPng(3000, H, (x, y) => (x / 7 + y / 5) % 256) },
    ]);
  await expect(page).toHaveURL(new RegExp(`/s/${sid}/c/[0-9a-f-]{36}$`), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Dịch chương", exact: true })).toBeEnabled({ timeout: 30_000 });

  const pager = page.locator(".cw-pager");
  const view = page.locator(".cw-source-view");
  const thumbs = page.getByRole("complementary", { name: "Danh sách ảnh gốc" });
  await thumbs.getByRole("button", { name: /^Ảnh 1/ }).click();
  await expect(pager).toContainText("Ảnh 1/3");
  await expect(page.getByRole("img", { name: "Ảnh gốc 1" })).toBeVisible();
  await expect.poll(async () => (await scrollState(view)).max).toBeGreaterThan(500);
  /** Đưa chuột vào giữa khung ảnh (đo lại: panel mở / đóng làm khung đổi chỗ). */
  const hover = async () => {
    const box = await view.boundingBox();
    if (!box) throw new Error("source view has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  await hover();

  // Ảnh đầu, cuộn lên: không có ảnh trước → đứng yên.
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(PAUSE);
  await expect(pager).toContainText("Ảnh 1/3");

  // Giữa ảnh cuộn xuống chỉ cuộn ảnh; Ctrl+cuộn (zoom) ở mép dưới không đổi ảnh.
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await scrollState(view)).top).toBeGreaterThan(0);
  await expect(pager).toContainText("Ảnh 1/3");
  await view.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(PAUSE);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(PAUSE);
  await expect(pager).toContainText("Ảnh 1/3");
  await page.getByRole("button", { name: /^Đang \d+%\. Bấm để/ }).click();
  await page.getByRole("button", { name: "Đang 100%. Bấm để vừa khung" }).click();
  await expect(page.getByRole("button", { name: /^Đang vừa khung/ })).toBeVisible();

  // Mép dưới, cuộn tiếp → ảnh 2, ở đầu ảnh; 2 wheel quán tính gửi liền không lật tiếp, không cuộn ảnh mới.
  await hover();
  await view.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(PAUSE);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, 100);
  await expect(pager).toContainText("Ảnh 2/3");
  await expect(page.getByRole("img", { name: "Ảnh gốc 2" })).toBeVisible();
  await page.waitForTimeout(FLIP_PAUSE_MS);
  await expect(pager).toContainText("Ảnh 2/3");
  expect((await scrollState(view)).top).toBe(0);

  // Mép trên ảnh 2, cuộn lên → ảnh 1, vào ở cuối ảnh.
  await page.waitForTimeout(COOLDOWN);
  await page.mouse.wheel(0, -300);
  await expect(pager).toContainText("Ảnh 1/3");
  await expect
    .poll(async () => {
      const s = await scrollState(view);
      return s.max > 500 && s.top >= s.max - 1;
    })
    .toBe(true);

  // Đang mở Cắt mép: cuộn quá mép không đổi ảnh.
  await page.waitForTimeout(COOLDOWN);
  await page.getByRole("button", { name: "Cắt mép", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Cắt mép" });
  await expect(panel).toBeVisible();
  await hover();
  await view.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(PAUSE);
  await page.mouse.wheel(0, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(PAUSE);
  await expect(pager).toContainText("Ảnh 1/3");
  await panel.getByRole("button", { name: "Huỷ" }).click();
  await expect(panel).toBeHidden();

  // Ảnh cuối, cuộn xuống quá mép: không có ảnh sau → đứng yên.
  await thumbs.getByRole("button", { name: /^Ảnh 3/ }).click();
  await expect(pager).toContainText("Ảnh 3/3");
  await expect(page.getByRole("img", { name: "Ảnh gốc 3" })).toBeVisible();
  await hover();
  await view.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(PAUSE);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(PAUSE);
  await expect(pager).toContainText("Ảnh 3/3");

  // Đang 100%, ảnh 3 rộng hơn khung: đổi sang ảnh 2 rồi về ảnh 3 → giữ 100%, cuộn ngang ở giữa ảnh.
  await page.getByRole("button", { name: /^Đang vừa khung/ }).click();
  await expect(page.getByRole("button", { name: "Đang 100%. Bấm để vừa khung" })).toBeVisible();
  await thumbs.getByRole("button", { name: /^Ảnh 2/ }).click();
  await thumbs.getByRole("button", { name: /^Ảnh 3/ }).click();
  await expect(pager).toContainText("Ảnh 3/3");
  await expect(page.getByRole("button", { name: "Đang 100%. Bấm để vừa khung" })).toBeVisible();
  await expect
    .poll(() =>
      view.evaluate((el) => {
        const slack = el.scrollWidth - el.clientWidth;
        return slack > 200 && Math.abs(el.scrollLeft - slack / 2) <= 1;
      }),
    )
    .toBe(true);
});
