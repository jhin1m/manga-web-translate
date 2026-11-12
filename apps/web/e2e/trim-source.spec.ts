/**
 * Cắt mép ảnh gốc trước "Dịch chương": nút Cắt mép ở rail trái → panel (ô số Trên / Dưới) + 2 thanh kéo trên canvas
 * (cùng số) → Enter / Lưu, Esc / Huỷ; đổi ảnh khi nháp đã khác thì tự lưu; zoom (nút, Ctrl+cuộn) không làm lệch px
 * ảnh thật; trim giữ sau khi tải lại, "Bỏ cắt" + Hoàn tác; "Dịch chương" tự lưu nháp chưa lưu rồi mới chạy, trang cuối cao đúng phần ảnh còn lại
 * (worker giả tính theo trim trong inputs).
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
  const thumb1 = sources.getByRole("button", { name: /^Ảnh 1/ });
  const thumb2 = sources.getByRole("button", { name: /^Ảnh 2/ });
  const railTrim = page.getByRole("button", { name: "Cắt mép", exact: true });
  const panel = page.getByRole("complementary", { name: "Cắt mép" });
  const topField = panel.getByLabel("Trên");
  const bottomField = panel.getByLabel("Dưới");
  const openTrim = async () => {
    await thumb2.click();
    await railTrim.click();
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

  // Không còn mục cắt trong menu chuột phải thumbnail; ngoài chế độ cắt không có thanh kéo.
  await thumb2.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Cắt mép|Bỏ cắt/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(top).toHaveCount(0);
  await expect(panel).toBeHidden();

  // Mở panel từ rail: thanh kéo hiện, panel báo "Ảnh 2/2", chưa cắt nên không có "Bỏ cắt".
  await openTrim();
  await expect(page.getByRole("img", { name: "Ảnh gốc 2" })).toBeVisible();
  await expect(panel.getByText("Ảnh 2/2")).toBeVisible();
  await expect(top).toBeFocused();
  await expect(panel.getByRole("button", { name: "Bỏ cắt" })).toHaveCount(0);
  await expect(topField).toHaveValue("0");

  // Chuột: kéo thanh trên xuống → ô Trên theo; Esc → không lưu, panel đóng, focus về nút rail.
  const box = await top.boundingBox();
  if (!box) throw new Error("top handle has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 42, { steps: 4 });
  await page.mouse.up();
  await expect(topField).not.toHaveValue("0");
  await page.keyboard.press("Escape");
  await expect(top).toHaveCount(0);
  await expect(panel).toBeHidden();
  await expect(railTrim).toBeFocused();
  expect(await trimmedOnServer()).toEqual([null, null]);

  // Gõ số: ô → thanh; kẹp ở ảnh còn lại ≥ MIN_TRIM_KEEP_PX; Huỷ không lưu.
  await railTrim.click();
  await topField.fill("20");
  await expect(top).toHaveAttribute("aria-valuenow", "20");
  await bottomField.fill("9999");
  await expect(bottomField).toHaveValue(String(H - 20 - 64));
  // Ô trống / chữ không phải số khi đang gõ: thanh đứng yên; rời ô thì ô về giá trị hợp lệ gần nhất.
  await bottomField.fill("");
  await expect(bottom).toHaveAttribute("aria-valuenow", String(20 + 64));
  await bottomField.pressSequentially("-");
  await expect(bottomField).toHaveValue("");
  await expect(bottom).toHaveAttribute("aria-valuenow", String(20 + 64));
  // Ký tự lạ bị bỏ, chữ số trước đó giữ nguyên (không bị coi là 0).
  await bottomField.pressSequentially("120e");
  await expect(bottomField).toHaveValue("120");
  await expect(bottom).toHaveAttribute("aria-valuenow", String(H - 120));
  await bottomField.pressSequentially(".5");
  await expect(bottomField).toHaveValue(String(H - 20 - 64));
  await bottomField.fill("");
  await bottomField.blur();
  await expect(bottomField).toHaveValue(String(H - 20 - 64));
  await bottomField.fill("0");
  await expect(bottom).toHaveAttribute("aria-valuenow", String(H));
  await topField.fill("9999");
  await expect(topField).toHaveValue(String(H - 64));
  await panel.getByRole("button", { name: "Huỷ" }).click();
  await expect(panel).toBeHidden();
  expect(await trimmedOnServer()).toEqual([null, null]);

  // Đổi ảnh khi nháp đã khác: tự lưu ảnh cũ, panel ở lại ở ảnh mới (nháp ảnh 1 chưa đổi nên không lưu gì).
  await railTrim.click();
  await bottomField.fill("30");
  await thumb1.click();
  await expect(panel.getByText("Ảnh 1/2")).toBeVisible();
  await expect(bottomField).toHaveValue("0");
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");
  await expect.poll(trimmedOnServer).toEqual([null, [0, 30]]);
  await thumb2.click();
  await expect(bottomField).toHaveValue("30");
  // Enter trong ô = Lưu; số vẫn đúng sau đó.
  await bottomField.fill("40");
  await bottomField.press("Enter");
  await expect(panel).toBeHidden();
  await expect.poll(trimmedOnServer).toEqual([null, [0, 40]]);

  // Zoom (nút, Ctrl+cuộn): thanh cắt vẫn đúng px ảnh thật.
  await railTrim.click();
  const img = page.getByRole("img", { name: "Ảnh gốc 2" });
  const imgBox = async () => {
    const b = await img.boundingBox();
    if (!b) throw new Error("image has no box");
    return b;
  };
  const fit = await imgBox();
  await page.getByRole("button", { name: "Phóng to" }).click();
  await expect.poll(async () => (await imgBox()).width).toBeGreaterThan(fit.width * 1.2);
  const zoomed = await imgBox();
  await page.keyboard.down("Control");
  await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + 40);
  await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await imgBox()).width).toBeGreaterThan(zoomed.width * 1.2);
  const big = await imgBox();
  const scale = big.width / 120;
  // Đường cắt của thanh dưới (mép dưới ô kéo) nằm đúng H − 40 px ảnh thật trên ảnh đang phóng.
  const handle = await bottom.boundingBox();
  if (!handle) throw new Error("bottom handle has no box");
  expect((handle.y + handle.height - big.y) / scale).toBeCloseTo(H - 40, -1);
  // Kéo thanh dưới lên 60 px màn hình = thêm 60 / scale px ảnh thật vào số cắt dưới.
  const bottomBox = await bottom.boundingBox();
  if (!bottomBox) throw new Error("bottom handle has no box");
  const gx = bottomBox.x + bottomBox.width / 2;
  const gy = bottomBox.y + bottomBox.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx, gy - 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await bottomField.inputValue()) - (40 + 60 / scale))).toBeLessThan(3);
  await bottomField.fill("40");
  // Về Vừa khung bằng nút %; đổi ảnh cũng về Vừa khung.
  await page.getByRole("button", { name: /^Đang \d+%\. Bấm để/ }).click();
  await expect.poll(async () => (await imgBox()).width).toBeCloseTo(fit.width, 0);
  await page.getByRole("button", { name: "Phóng to" }).click();
  await thumb1.click();
  await expect(page.getByRole("button", { name: /^Đang vừa khung/ })).toBeVisible();
  await thumb2.click();
  await expect(page.getByRole("button", { name: /^Đang vừa khung/ })).toBeVisible();
  await page.getByRole("button", { name: "Phóng to" }).click();
  await thumb1.click();
  await thumb2.click();
  await expect(page.getByRole("button", { name: /^Đang vừa khung/ })).toBeVisible();
  await panel.getByRole("button", { name: "Huỷ" }).click();
  await expect.poll(trimmedOnServer).toEqual([null, [0, 40]]);

  // Bàn phím: thanh dưới ↑ 1 px, Shift+↑ 10 px; kẹp ở mép trên ảnh còn lại ≥ MIN_TRIM_KEEP_PX; Enter = Lưu.
  await thumb2.click();
  await railTrim.click();
  await bottomField.fill("0");
  await top.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("Shift+ArrowDown");
  await expect(topField).toHaveValue(String(H - 64));
  for (let i = 0; i < 30; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect(topField).toHaveValue("0");
  await bottom.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowUp");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await expect(bottomField).toHaveValue(String(BOTTOM));
  await expect(bottom).toHaveAttribute("aria-valuenow", String(H - BOTTOM));
  await page.keyboard.press("Enter");
  await expect(bottom).toHaveCount(0);
  await expect(railTrim).toBeFocused();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");
  await expect(page.getByRole("status").filter({ hasText: "Đã cắt mép ảnh 2" })).toBeVisible();
  await expect(page.getByText("Phần mờ bị bỏ khi cắt trang")).toBeVisible();
  await expect.poll(trimmedOnServer).toEqual([null, [0, BOTTOM]]);

  await page.reload();
  await expect(sources.locator("img")).toHaveCount(2);
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");

  // Bỏ cắt → Hoàn tác trả đúng trim trước đó.
  await thumb2.click();
  await railTrim.click();
  await expect(bottomField).toHaveValue(String(BOTTOM));
  await panel.getByRole("button", { name: "Bỏ cắt" }).click();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2");
  await expect.poll(trimmedOnServer).toEqual([null, null]);
  await page
    .getByRole("status")
    .filter({ hasText: "Đã bỏ cắt ảnh 2" })
    .getByRole("button", { name: "Hoàn tác" })
    .click();
  await expect(thumb2).toHaveAccessibleName("Ảnh 2 · Đã cắt mép");
  await expect.poll(trimmedOnServer).toEqual([null, [0, BOTTOM]]);

  // Lưu lỗi lúc bấm "Dịch chương" với nháp chưa lưu: không chạy, báo lỗi nêu số ảnh, "Thử lại" ghi lại đúng số đó.
  await thumb2.click();
  await railTrim.click();
  await bottomField.fill("70");
  const failPatch = (route: import("@playwright/test").Route) => route.fulfill({ status: 500, body: "{}" });
  await page.route("**/api/chapters/*/source-files/*", failPatch);
  await step1.click();
  const failToast = page.getByRole("alert").filter({ hasText: "Không lưu được cắt mép ảnh 2" });
  await expect(failToast).toBeVisible();
  await expect(step1).toBeEnabled();
  const draftRes = await page.request.get(`/api/chapters/${chapterId}/pages`);
  expect(((await draftRes.json()) as { pages: unknown[] }).pages).toHaveLength(0);
  await page.unroute("**/api/chapters/*/source-files/*", failPatch);
  await failToast.getByRole("button", { name: "Thử lại" }).click();
  await expect.poll(trimmedOnServer).toEqual([null, [0, 70]]);

  // Dịch chương với nháp chưa lưu: tự lưu trước rồi mới chạy; trang cuối cao H − bottom, trang đầu giữ nguyên.
  await expect(panel).toBeVisible();
  await bottomField.fill("80");
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
    .toEqual([1000, H - 80]);
  ready = true;
  await worker;
});
