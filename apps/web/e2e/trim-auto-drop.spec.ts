/**
 * Tự cắt khi thả ảnh: series đã học dải banner cuối ảnh → chương mới có đúng banner được cắt sẵn (cờ "Credit · tự cắt"),
 * "Bỏ cắt" + Hoàn tác không lỗi, "Dịch chương" cho trang cuối cao H − dải; chương không banner không bị cắt gì. Đo thời
 * gian so dải cho chương 96 ảnh với 5 dải.
 */
import { hamming } from "@mtl/shared";
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
/** Cùng banner đáy nhưng tranh phía trên khác hẳn (không giống từng điểm ảnh với `banner`). */
const bannerOverOtherArt = (x: number, y: number) => (y >= H - BAND ? stripes(x) : (x * 3 + y * 5) % 200);
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
  const trimPanel = page.getByRole("complementary", { name: "Cắt mép" });
  const openTrim = async (n: number) => {
    await sources.getByRole("button", { name: new RegExp(`^Ảnh ${n}`) }).click();
    await page.getByRole("button", { name: "Cắt mép", exact: true }).click();
  };
  await openTrim(2);
  await page.getByRole("slider", { name: "Mép dưới" }).focus();
  for (let i = 0; i < BAND / 10; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect(trimPanel.getByLabel("Dưới")).toHaveValue(String(BAND));
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
  const chapterId = await drop([png("p1.png", plain), png("p2.png", plain), png("p3.png", bannerOverOtherArt)]);
  expect(await trims(chapterId)).toEqual([null, null, [0, BAND, "credit"]]);
  await page.reload();
  await expect(sources.locator("img")).toHaveCount(3);
  const thumb3 = sources.getByRole("button", { name: /^Ảnh 3/ });
  await expect(thumb3).toHaveAccessibleName("Ảnh 3 · Credit · tự cắt");
  await expect(sources.getByRole("button", { name: /^Ảnh 1/ })).toHaveAccessibleName("Ảnh 1");

  // Bỏ cắt → Hoàn tác không lỗi; trim trở lại (đặt lại bằng tay nên không còn là cắt tự động).
  await openTrim(3);
  // Banner tự cắt: panel gắn nhãn "Credit · tự cắt" và hiện đúng số px đã cắt.
  await expect(trimPanel.getByText("Credit · tự cắt")).toBeVisible();
  await expect(trimPanel.getByLabel("Dưới")).toHaveValue(String(BAND));
  await trimPanel.getByRole("button", { name: "Bỏ cắt" }).click();
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

/**
 * Băm dải thật trong Chromium: cùng banner dưới nền tranh khác nhau, cùng banner ở bề rộng 720 và 800 (co lại), mép
 * trên, và đáy không có banner. Khoảng cách Hamming đo được in ra; ngưỡng khớp là 6.
 */
test("the band hash of one banner stays within the match threshold across art, widths and edges", async ({ page }) => {
  await login(page);
  const r = await page.evaluate(async () => {
    const mod = await import(/* @vite-ignore */ "/src/features/upload/image-fingerprint.ts");
    const BAND_H = 100;
    const BASE_W = 720;
    /** Số giả ngẫu nhiên tất định. */
    const rng = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    /** Banner 720×100: nền màu, khung, nhiều khối chữ giả. */
    const bannerCanvas = () => {
      const c = new OffscreenCanvas(BASE_W, BAND_H);
      const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
      const grad = g.createLinearGradient(0, 0, BASE_W, 0);
      grad.addColorStop(0, "#1b3a6b");
      grad.addColorStop(1, "#7a2150");
      g.fillStyle = grad;
      g.fillRect(0, 0, BASE_W, BAND_H);
      const r = rng(7);
      g.fillStyle = "#f4e9c8";
      for (let i = 0; i < 40; i++) g.fillRect(20 + r() * 640, 10 + r() * 70, 12 + r() * 90, 6 + r() * 12);
      g.fillStyle = "#ffcc00";
      g.fillRect(560, 20, 120, 60);
      return c;
    };
    const artCanvas = (w: number, h: number, seed: number, light: boolean) => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
      const r = rng(seed);
      g.fillStyle = light ? "#fafafa" : "#d9d3c4";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 120; i++) {
        g.fillStyle = `hsl(${Math.floor(r() * 360)} ${Math.floor(r() * 60)}% ${Math.floor(20 + r() * 70)}%)`;
        g.fillRect(r() * w, r() * h, 20 + r() * 200, 20 + r() * 200);
      }
      return c;
    };
    /** Trang rộng `w`: tranh (cao 600) rồi banner ở đáy (hoặc banner rồi tranh khi edge = top); gutter = dải trắng đệm. */
    const page = async (w: number, edge: "top" | "bottom", seed: number, gutter: number, withBanner = true) => {
      const scale = w / BASE_W;
      const bh = Math.round(BAND_H * scale);
      const artH = 600;
      const c = new OffscreenCanvas(w, artH + gutter + (withBanner ? bh : 0));
      const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
      g.imageSmoothingQuality = "high";
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      const art = artCanvas(w, artH, seed, false);
      const banner = bannerCanvas();
      if (edge === "bottom") {
        g.drawImage(art, 0, 0);
        if (withBanner) g.drawImage(banner, 0, artH + gutter, w, bh);
      } else {
        if (withBanner) g.drawImage(banner, 0, 0, w, bh);
        g.drawImage(art, 0, bh + gutter);
      }
      return c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    };
    const band = async (blob: Blob, edge: "top" | "bottom", w: number) => {
      const f = await mod.bandFingerprint(blob, edge, Math.round(BAND_H * (w / BASE_W)));
      return f?.dhash ?? null;
    };

    const out: Record<string, string | null | boolean> = {};
    for (const edge of ["bottom", "top"] as const) {
      out[`${edge}.learn`] = await band(await page(720, edge, 1, 0), edge, 720);
      out[`${edge}.art2`] = await band(await page(720, edge, 2, 0), edge, 720);
      out[`${edge}.art3.gutter40`] = await band(await page(720, edge, 3, 40), edge, 720);
      out[`${edge}.art4.gutter150`] = await band(await page(720, edge, 4, 150), edge, 720);
      out[`${edge}.w800`] = await band(await page(800, edge, 5, 0), edge, 800);
      out[`${edge}.w690`] = await band(await page(690, edge, 6, 0), edge, 690);
      out[`${edge}.nobanner`] = await band(await page(720, edge, 8, 0, false), edge, 720);
    }

    // Đường chạy thật (bandTrims): học ở 720, thả ở 800 / tranh khác; đáy không banner không khớp.
    const learnedBlob = await page(720, "bottom", 1, 0);
    const learned = await mod.bandFingerprint(learnedBlob, "bottom", BAND_H);
    const bands = [{ edge: "bottom", ...learned }];
    const targets = [
      await page(720, "bottom", 11, 0),
      await page(800, "bottom", 12, 0),
      await page(720, "bottom", 13, 0, false),
    ];
    const fps = await mod.fingerprintAll(targets);
    const trims = await mod.bandTrims(targets, fps, bands);
    return { hashes: out, trims };
  });

  const d = (a: string | null | boolean, b: string | null | boolean) => hamming(a as string, b as string);
  const report: Record<string, number> = {};
  for (const edge of ["bottom", "top"]) {
    const learn = r.hashes[`${edge}.learn`];
    for (const k of ["art2", "art3.gutter40", "art4.gutter150", "w800", "w690"]) {
      report[`${edge}.${k}`] = d(learn, r.hashes[`${edge}.${k}`]);
    }
    report[`${edge}.nobanner`] = d(learn, r.hashes[`${edge}.nobanner`]);
  }
  console.log(`band hamming distances (threshold 6): ${JSON.stringify(report)}`);
  for (const [k, v] of Object.entries(report)) {
    if (k.endsWith("nobanner")) expect(v, k).toBeGreaterThan(6);
    else expect(v, k).toBeLessThanOrEqual(6);
  }
  expect(r.trims).toEqual([{ top: 0, bottom: 100 }, { top: 0, bottom: 111 }, null]);
});
