/**
 * Tự cắt khi thả ảnh: series đã học dải banner cuối ảnh → chương mới có đúng banner được cắt sẵn (cờ "Credit · tự cắt"),
 * "Bỏ cắt" + Hoàn tác không lỗi, "Dịch chương" cho trang cuối cao H − dải; chương không banner không bị cắt gì. Đo thời
 * gian so dải cho chương 96 ảnh với 5 dải.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { runFakeWorker } from "./fake-worker.ts";
import { grayPng } from "./gray-png.ts";
import { login, state } from "./helpers.ts";

const W = 120;
const H = 300;
const BAND = 50;
/** Sọc dọc xen kẽ → dHash có nhiều bit 1, không bị coi là ảnh trơn. */
const stripes = (x: number) => (Math.floor(x / 13) % 2 ? 30 : 220);
/** Chỉ dải đáy có sọc; phần còn lại là dốc sáng dần (hash trơn). */
const banner = (x: number, y: number) => (y >= H - BAND ? stripes(x) : x * 2);
const plain = (x: number, y: number) => x + y / 4;

/** Series tạo trong test; dọn cả khi test lỗi để không làm đổi series tự đoán ở các test thả file sau. */
let sid: string | null = null;

test.afterEach(async ({ page }) => {
  if (!sid) return;
  const id = sid;
  sid = null;
  await page.request.delete(`/api/series/${id}`, { headers: { origin: WEB_URL } });
});

const png = (name: string, shade: (x: number, y: number) => number) => ({
  name,
  mimeType: "image/png",
  buffer: grayPng(W, H, shade),
});

test("a chapter dropped with the learned bottom banner is trimmed on creation; one without it is not", async ({
  page,
}) => {
  await login(page);
  const created = await page.request.post(`/api/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series tự cắt e2e" },
  });
  expect(created.status()).toBe(201);
  sid = ((await created.json()) as { id: string }).id;
  const seriesId = sid;

  const drop = async (files: ReturnType<typeof png>[]) => {
    await page.goto(`/s/${seriesId}`);
    await page
      .getByRole("region", { name: "Thêm chương tiếp theo" })
      .locator('input[type="file"]')
      .setInputFiles(files);
    await expect(page).toHaveURL(new RegExp(`/s/${seriesId}/c/[0-9a-f-]{36}$`), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Dịch chương", exact: true })).toBeEnabled({ timeout: 30_000 });
    return page.url().split("/").pop() ?? "";
  };
  const trims = async (chapterId: string) => {
    const res = await page.request.get(`/api/chapters/${chapterId}`);
    const body = (await res.json()) as {
      source_files: { ord: number; trim: { top: number; bottom: number; by: string } | null }[];
    };
    return [...body.source_files]
      .sort((a, b) => a.ord - b.ord)
      .map((f) => f.trim && [f.trim.top, f.trim.bottom, f.trim.by]);
  };
  const sources = page.getByRole("complementary", { name: "Danh sách ảnh gốc" });

  // Chương 1: cắt tay dải đáy ảnh cuối rồi "Luôn cắt ở series này".
  await drop([png("p1.png", plain), png("p2.png", banner)]);
  await page.reload();
  await expect(sources.locator("img")).toHaveCount(2);
  await sources.getByRole("button", { name: /^Ảnh 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cắt mép ảnh 2…" }).click();
  await page.getByRole("slider", { name: "Mép dưới" }).focus();
  for (let i = 0; i < BAND / 10; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByText(`Trên 0 px · Dưới ${BAND} px`)).toBeVisible();
  await page.keyboard.press("Enter");
  await page
    .getByRole("status")
    .filter({ hasText: "Đã cắt mép ảnh 2" })
    .getByRole("button", { name: "Luôn cắt ở series này" })
    .click();
  await expect(page.getByText("Đã học 1 dải")).toBeVisible();

  // Chương không có banner: không ảnh nào bị cắt.
  const clean = await drop([png("a.png", plain), png("b.png", (x, y) => 255 - x - y / 4), png("c.png", plain)]);
  expect(await trims(clean)).toEqual([null, null, null]);

  // Chương có banner ở ảnh cuối: cắt sẵn đúng dải, cờ "Credit · tự cắt".
  const chapterId = await drop([png("p1.png", plain), png("p2.png", plain), png("p3.png", banner)]);
  expect(await trims(chapterId)).toEqual([null, null, [0, BAND, "credit"]]);
  await page.reload();
  await expect(sources.locator("img")).toHaveCount(3);
  const thumb3 = sources.getByRole("button", { name: /^Ảnh 3/ });
  await expect(thumb3).toHaveAccessibleName("Ảnh 3 · Credit · tự cắt");
  await expect(sources.getByRole("button", { name: /^Ảnh 1/ })).toHaveAccessibleName("Ảnh 1");

  // Bỏ cắt → Hoàn tác không lỗi; trim trở lại (đặt lại bằng tay nên không còn là cắt tự động).
  await thumb3.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bỏ cắt" }).click();
  await expect(thumb3).toHaveAccessibleName("Ảnh 3");
  await expect.poll(() => trims(chapterId)).toEqual([null, null, null]);
  await page
    .getByRole("status")
    .filter({ hasText: "Đã bỏ cắt ảnh 3" })
    .getByRole("button", { name: "Hoàn tác" })
    .click();
  await expect(thumb3).toHaveAccessibleName("Ảnh 3 · Đã cắt mép");
  await expect.poll(() => trims(chapterId)).toEqual([null, null, [0, BAND, "user"]]);

  // Dịch chương: trang cuối cao H − dải.
  let ready = false;
  const worker = runFakeWorker(state.token, () => ready, 60_000);
  const step1 = page.getByRole("button", { name: "Dịch chương", exact: true });
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
    .toEqual([1000, 1000, H - BAND]);
  ready = true;
  await worker;
});

test("matching 5 learned bands against a 96-image chapter stays well under the time budget", async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async () => {
    const mod = await import(/* @vite-ignore */ "/src/features/upload/image-fingerprint.ts");
    const IMG_W = 800;
    const IMG_H = 1200;
    const blobs: Blob[] = [];
    for (let i = 0; i < 96; i++) {
      const canvas = new OffscreenCanvas(IMG_W, IMG_H);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = `hsl(${(i * 37) % 360} 40% 85%)`;
      ctx.fillRect(0, 0, IMG_W, IMG_H);
      ctx.fillStyle = "#222";
      for (let k = 0; k < 40; k++) ctx.fillRect((k * 53 + i * 7) % IMG_W, (k * 97 + i * 13) % IMG_H, 60, 8 + (k % 5));
      blobs.push(await canvas.convertToBlob({ type: "image/png" }));
    }
    const fps = await mod.fingerprintAll(blobs);
    const bands = [
      { edge: "top", dhash: "aaaaaaaaaaaaaaaa", width: 800, height: 90 },
      { edge: "top", dhash: "5555555555555555", width: 720, height: 120 },
      { edge: "top", dhash: "0f0f0f0f0f0f0f0f", width: 800, height: 60 },
      { edge: "bottom", dhash: "f0f0f0f0f0f0f0f0", width: 800, height: 150 },
      { edge: "bottom", dhash: "3333333333333333", width: 760, height: 100 },
    ];
    const t0 = performance.now();
    const trims = await mod.bandTrims(blobs, fps, bands);
    return {
      ms: performance.now() - t0,
      matched: trims.filter(Boolean).length,
      fingerprinted: fps.filter(Boolean).length,
    };
  });
  console.log(`bandTrims(96 images, 5 bands): ${result.ms.toFixed(1)} ms`);
  expect(result.fingerprinted).toBe(96);
  expect(result.matched).toBe(0);
  expect(result.ms).toBeLessThan(300);
});
