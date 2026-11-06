/**
 * Panel khối + thanh phụ công cụ ở 1280x800: panel đóng mặc định, đè lên canvas (canvas không đổi bề ngang), tự mở khi
 * có nội dung phải xử lý mà không chọn khối (AI có bản mới, xung đột khi lưu) và không tự đóng khi còn nội dung; khối
 * bị panel che thì canvas tự cuộn lộ ra (kể cả 100% zoom, chia đôi gốc / dịch); thanh phụ của Tẩy chữ / Quét chữ /
 * Chữ giữ đủ chức năng; thao tác trang (dịch / dịch lại, bỏ chỉnh sửa tay, ẩn) ở menu chuột phải cột trang; chi tiết
 * lỗi kỹ thuật của trang đọc được ở Hoạt động; chỉ xem thì panel không cho sửa.
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { runFakeWorker } from "./fake-worker.ts";
import { apiReadyChapter, blockPanel, login, openPanel, pageThumb, railButton, state, toolBar } from "./helpers.ts";

test.use({ viewport: { width: 1280, height: 800 } });

const headers = { origin: WEB_URL };
/** Số chương riêng của spec này. */
let seq = 9400;
const nextNumber = () => String(++seq);
const chapterUrl = (id: string) => `/s/${state.seriesId}/c/${id}`;

type Box = { x: number; y: number; w: number; h: number };
type PageBody = { version: number; state: { text_boxes: unknown[]; regions: { translation: string }[] } };

const progress = async (page: Page, chapterId: string) =>
  (await (await page.request.get(`/api/chapters/${chapterId}/progress`)).json()) as {
    pages: { id: string; ord: number; ai_update_available: boolean; status: string }[];
  };

async function readyChapter(page: Page, pagesPerSource = 1) {
  const chapterId = await apiReadyChapter(page, nextNumber(), { pagesPerSource });
  const pages = (await progress(page, chapterId)).pages.sort((a, b) => a.ord - b.ord);
  return { chapterId, pageIds: pages.map((p) => p.id), pageId: pages[0]?.id ?? "" };
}

/** `region` = vùng OCR gắn vào (t0 của worker giả) hoặc null = khối tự thêm. */
const textBox = (id: string, b: Box, region: string | null = "t0") => ({
  id,
  region_id: region,
  x: b.x,
  y: b.y,
  w: b.w,
  h: b.h,
  rotation: 0,
  text: "Xin chào",
  lines: ["Xin chào"],
  font_family: "PatrickHand-Regular",
  font_size: 22,
  line_height: 1.15,
  pad: 4,
  letter_spacing: 0,
  align: "center",
  fill: "#000000",
  stroke: null,
  auto_fit: false,
  hidden: false,
});

/** Ghi state trang qua API (cần khoá chương) — giống người dùng sửa tay. */
async function writeState(page: Page, chapterId: string, pageId: string, edit: (s: PageBody["state"]) => void) {
  const detail = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as PageBody;
  edit(detail.state);
  expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  const put = await page.request.put(`/api/pages/${pageId}/state`, {
    headers: { ...headers, "if-match": `"${detail.version}"` },
    data: { state: detail.state },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
}

async function open(page: Page, chapterId: string) {
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
}

const viewOf = (page: Page) =>
  page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/features/editor/store.ts");
    return m.editorStore.getState().view;
  });

/** Đặt khung nhìn rồi đợi canvas vẽ xong (2 khung hình) để chuột bấm đúng chỗ. */
const setView = (page: Page, v: { scale: number; x: number; y: number }) =>
  page.evaluate(async (view) => {
    const m = await import(/* @vite-ignore */ "/src/features/editor/store.ts");
    m.editorStore.getState().setView(view);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }, v);

/** Hộp khối trên màn hình (toạ độ viewport) theo khung nhìn hiện tại. */
async function screenRect(page: Page, b: Box) {
  const view = await viewOf(page);
  const frame = await page.locator(".ed-canvas").boundingBox();
  if (!frame) throw new Error("no canvas");
  const x = frame.x + view.x + b.x * view.scale;
  const y = frame.y + view.y + b.y * view.scale;
  return { x, y, w: b.w * view.scale, h: b.h * view.scale, frame };
}

async function clickBlock(page: Page, b: Box) {
  const r = await screenRect(page, b);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

const canvasBox = async (page: Page) => {
  const b = await page.locator(".ed-canvas").boundingBox();
  if (!b) throw new Error("no canvas");
  return b;
};

/** Sinh "AI có bản mới": trang đã sửa tay rồi dịch lại → server giữ bản sửa tay, bật cờ. */
async function makeAiUpdate(page: Page, chapterId: string, pageId: string) {
  await writeState(page, chapterId, pageId, (s) => {
    const r = s.regions[0];
    if (r) r.translation = "Bản sửa tay";
  });
  const res = await page.request.post(`/api/chapters/${chapterId}/translate`, {
    headers,
    data: { page_ids: [pageId] },
  });
  expect(res.status()).toBe(202);
  let stop = false;
  const worker = runFakeWorker(state.token, () => stop, 30_000);
  await expect
    .poll(async () => (await progress(page, chapterId)).pages.find((p) => p.id === pageId)?.ai_update_available, {
      timeout: 30_000,
    })
    .toBe(true);
  stop = true;
  await worker;
}

test("AI update with no block selected opens the panel by itself and keeps it until acknowledged", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await makeAiUpdate(page, chapterId, pageId);
  await open(page, chapterId);

  // Không chọn khối nào mà panel tự mở, hiện bảng "Có kết quả AI mới".
  const panel = blockPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Có kết quả AI mới")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Chọn & sửa" })).toBeVisible();
  await panel.getByRole("button", { name: "Xem khác biệt" }).click();
  await expect(panel.locator(".ed-diff li")).toHaveCount(1);
  await expect(panel.locator(".ed-old")).toHaveText("Bản sửa tay");
  await expect(panel.locator(".ed-new")).toHaveText("Xin chào");

  // Bấm nền canvas / Esc không đóng panel khi còn nội dung chưa xử lý.
  await page.locator(".ed-canvas").click({ position: { x: 700, y: 10 } });
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Có kết quả AI mới")).toBeVisible();

  // "Đã xem, ẩn thông báo" → hết nội dung, không chọn khối → panel đóng.
  await panel.getByRole("button", { name: "Đã xem, ẩn thông báo" }).click();
  await expect(panel).toBeHidden();
  await expect
    .poll(async () => (await progress(page, chapterId)).pages.find((p) => p.id === pageId)?.ai_update_available)
    .toBe(false);

  // Tải lại: hết cờ nên panel đóng mặc định.
  await page.reload();
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await expect(panel).toBeHidden();
});

test("AI update shows even while a block of the page is selected, above the block form", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await makeAiUpdate(page, chapterId, pageId);
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-one", { x: 300, y: 300, w: 160, h: 60 })];
  });
  await open(page, chapterId);
  const panel = blockPanel(page);
  await expect(panel.getByText("Có kết quả AI mới")).toBeVisible();
  await clickBlock(page, { x: 300, y: 300, w: 160, h: 60 });
  await expect(panel.getByRole("heading", { name: "Khối 1/1" })).toBeVisible();
  await expect(panel.getByText("Có kết quả AI mới")).toBeVisible();
  await expect(panel.locator("#cw-translation")).toBeVisible();
});

/** Giả xung đột khi lưu bằng cách đặt thẳng vào store (luật rebase đã có unit test); kiểm hành vi của panel. */
async function injectConflict(page: Page) {
  await page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/features/editor/store.ts");
    const st = m.editorStore.getState();
    const region = st.doc?.regions[0];
    if (!st.base || !st.doc || !region) throw new Error("page not loaded");
    st.rebased(st.base, st.baseVersion, st.doc, [
      {
        key: "e2e-conflict",
        reason: "changed_on_server",
        fields: ["translation"],
        op: {
          t: "update",
          coll: "regions",
          id: region.id,
          fields: { translation: { from: "Xin chào", to: "Bản của tôi" } },
          local: { ...region, translation: "Bản của tôi" },
        },
      },
    ]);
  });
}

test("a save conflict opens the panel and it stays open while conflicts remain, even after deselecting", async ({
  page,
}) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-one", { x: 300, y: 300, w: 160, h: 60 })];
  });
  await open(page, chapterId);
  const panel = blockPanel(page);
  await expect(panel).toBeHidden();

  await injectConflict(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("1 thay đổi chưa áp được")).toBeVisible();

  // Chọn khối rồi bỏ chọn (Esc): panel không đóng vì còn xung đột.
  await clickBlock(page, { x: 300, y: 300, w: 160, h: 60 });
  await expect(panel.getByRole("heading", { name: "Khối 1/1" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("heading", { name: "Chọn & sửa" })).toBeVisible();
  await expect(panel.getByText("1 thay đổi chưa áp được")).toBeVisible();

  // Đổi công cụ cũng không giấu xung đột.
  await page.keyboard.press("t");
  await expect(toolBar(page, "Thêm chữ")).toBeVisible();
  await expect(panel.getByText("1 thay đổi chưa áp được")).toBeVisible();
  await page.keyboard.press("v");

  // Người dùng thu panel bằng tay → băng cảnh báo báo còn xung đột và đưa về panel.
  await panel.getByRole("button", { name: "Thu panel" }).click();
  await expect(panel).toBeHidden();
  const band = page.getByRole("alert", { name: "Cảnh báo chương" });
  await expect(band).toContainText("1 thay đổi chưa áp được");
  await band.getByRole("button", { name: "Xem" }).click();
  await expect(panel.getByText("1 thay đổi chưa áp được")).toBeVisible();

  // Xử lý xong xung đột (Bỏ) → hết nội dung, không chọn khối → panel tự đóng.
  await panel.getByRole("button", { name: "Bỏ", exact: true }).click();
  await expect(panel).toBeHidden();
});

test("opening and closing the block panel never changes the canvas box", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-one", { x: 300, y: 300, w: 160, h: 60 })];
  });
  await open(page, chapterId);
  const panel = blockPanel(page);
  await expect(panel).toBeHidden();
  const before = await canvasBox(page);
  // Số đo thực tế ở khung 1280 khi không chọn gì (rail 64px + cột trang 112px hiện tại).
  console.log(`canvas 1280x800 (no selection): ${before.width}x${before.height} at x=${before.x}`);
  expect(before.width).toBe(1280 - 64 - 112);

  await clickBlock(page, { x: 300, y: 300, w: 160, h: 60 });
  await expect(panel).toBeVisible();
  expect(await canvasBox(page)).toEqual(before);
  const pb = await panel.boundingBox();
  expect(pb?.x).toBeCloseTo(before.x, 0);
  expect((pb?.width ?? 0) + (pb?.x ?? 0)).toBeLessThan(before.x + before.width);
  // Khung đo của store (dùng để cuộn lộ khối) khớp với canvas thật.
  const frame = await page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ "/src/features/editor/chapter-store.ts");
    const s = m.chapterStore.getState();
    return { w: s.box.w, h: s.box.h, cover: s.cover };
  });
  expect(frame.w).toBe(before.width);
  expect(frame.h).toBe(before.height);
  expect(frame.cover).toBe(Math.round(pb?.width ?? 0));

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  expect(await canvasBox(page)).toEqual(before);
});

test("a block at the left edge is scrolled out from under the panel at 100% zoom; later scrolling keeps it clear", async ({
  page,
}) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  const left: Box = { x: 8, y: 200, w: 120, h: 60 };
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-left", left)];
  });
  await open(page, chapterId);
  await page.locator(".cw-zoom").getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.locator(".cw-zoom .mono")).toHaveText("100%");
  const panel = blockPanel(page);
  const before = await screenRect(page, left);

  await clickBlock(page, left);
  await expect(panel).toBeVisible();
  const pb = await panel.boundingBox();
  if (!pb) throw new Error("no panel");
  // Trang rộng 720 căn giữa khung 1104: khối ở x=8 nằm dưới panel (rộng 272) nếu không cuộn.
  expect(before.x).toBeLessThan(pb.x + pb.width);
  await expect.poll(async () => (await screenRect(page, left)).x).toBeGreaterThanOrEqual(pb.x + pb.width);
  const clear = await screenRect(page, left);
  // Cuộn dọc tiếp: khung nhìn không bị kẹp ngược về giữa (khối vẫn không bị panel che).
  await page.mouse.move(clear.frame.x + clear.frame.width - 150, clear.frame.y + 300);
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(250);
  expect((await screenRect(page, left)).x).toBeCloseTo(clear.x, 0);
});

test("a block near the bottom of the page is brought into view above the page end", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  const top: Box = { x: 300, y: 100, w: 150, h: 60 };
  const bottom: Box = { x: 300, y: 930, w: 150, h: 50 };
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-top", top), textBox("tb-bottom", bottom, null)];
  });
  await open(page, chapterId);
  await page.locator(".cw-zoom").getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.locator(".cw-zoom .mono")).toHaveText("100%");
  // Alt+↓ chọn khối kế (xuyên khối, cuộn tới): khối thứ hai nằm sát đáy trang, ngoài khung nhìn lúc đầu.
  await page.locator(".ed-canvas").click({ position: { x: 700, y: 10 } });
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Alt+ArrowDown");
  const panel = blockPanel(page);
  await expect(panel.getByRole("heading", { name: "Khối 2/2" })).toBeVisible();
  await expect
    .poll(async () => {
      const r = await screenRect(page, bottom);
      return r.y + r.h <= r.frame.y + r.frame.height && r.y >= r.frame.y;
    })
    .toBe(true);
});

test("split original / translated at 100%: a block of the translated column under the panel is revealed", async ({
  page,
}) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  const left: Box = { x: 8, y: 200, w: 120, h: 60 };
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-left", left)];
  });
  await open(page, chapterId);
  await page.getByRole("button", { name: "Thêm thao tác" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Chia đôi gốc / dịch" }).click();
  await page.locator(".cw-zoom").getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.locator(".cw-zoom .mono")).toHaveText("100%");
  // Cuộn ngang cho cột Dịch (x ≥ 0) nằm dưới mép trái panel.
  const view = await viewOf(page);
  await setView(page, { ...view, x: 100 });
  const panel = blockPanel(page);
  await clickBlock(page, left);
  await expect(panel).toBeVisible();
  const pb = await panel.boundingBox();
  if (!pb) throw new Error("no panel");
  await expect.poll(async () => (await screenRect(page, left)).x).toBeGreaterThanOrEqual(pb.x + pb.width);
  // Vẫn ở chế độ chia đôi: cột Gốc còn nằm bên trái cột Dịch.
  expect((await viewOf(page)).scale).toBe(1);
});

test.describe("canvas toolbars keep every function", () => {
  test("Tẩy chữ: paint, erase strokes, brush size, clear strokes, remove the painted text", async ({ page }) => {
    await login(page);
    const { chapterId, pageId } = await readyChapter(page);
    await open(page, chapterId);
    const cleanRev = async () =>
      ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { page: { clean_rev: number } }).page
        .clean_rev;
    const rev0 = await cleanRev();

    const bar = await openPanel(page, "brush");
    await expect(bar).toBeVisible();
    await expect(blockPanel(page)).toBeHidden();
    const paint = bar.getByRole("button", { name: "Tô", exact: true });
    const erase = bar.getByRole("button", { name: "Tẩy nét", exact: true });
    const remove = bar.getByRole("button", { name: "Xoá chữ vùng tô" });
    const clear = bar.getByRole("button", { name: "Bỏ nét" });
    await expect(paint).toHaveAttribute("aria-pressed", "true");
    await expect(remove).toBeDisabled();
    await expect(clear).toBeDisabled();

    // Cỡ bút.
    const size = bar.getByRole("slider");
    await size.fill("60");
    await expect(bar.getByText("60", { exact: true })).toBeVisible();

    // Tô 1 nét.
    const f = await canvasBox(page);
    const stroke = async () => {
      await page.mouse.move(f.x + f.width / 2 - 80, f.y + 300);
      await page.mouse.down();
      await page.mouse.move(f.x + f.width / 2 + 80, f.y + 300, { steps: 8 });
      await page.mouse.up();
    };
    await stroke();
    await expect(remove).toBeEnabled();
    await expect(clear).toBeEnabled();

    // Tẩy nét: chuyển chế độ (cũng bằng phím E), kéo qua nét tô; nút Tô / Tẩy nét phản ánh chế độ.
    await erase.click();
    await expect(erase).toHaveAttribute("aria-pressed", "true");
    await expect(paint).toHaveAttribute("aria-pressed", "false");
    await stroke();
    await expect(remove).toBeEnabled();
    await page.keyboard.press("b");
    await expect(paint).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await expect(erase).toHaveAttribute("aria-pressed", "true");

    // Bỏ nét: hết nét, nút xoá chữ tắt lại.
    await clear.click();
    await expect(remove).toBeDisabled();
    await expect(clear).toBeDisabled();

    // Tô lại rồi "Xoá chữ vùng tô": đi hết luồng reinpaint (mask → presigned POST → job) → ảnh sạch đổi bản, nét bị bỏ.
    await paint.click();
    await stroke();
    const reinpaint = page.waitForRequest((r) => r.url().includes("/reinpaint") && r.method() === "POST");
    await remove.click();
    const body = (await reinpaint).postDataJSON() as { user_mask_key: string; base_clean_rev: number };
    expect(body.base_clean_rev).toBe(rev0);
    expect(body.user_mask_key).toBeTruthy();
    let stop = false;
    const worker = runFakeWorker(state.token, () => stop, 30_000, { capabilities: ["page.reinpaint"] });
    await expect.poll(cleanRev, { timeout: 30_000 }).toBeGreaterThan(rev0);
    stop = true;
    await worker;
    await expect(remove).toBeDisabled();
    await expect(clear).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("Quét chữ: shows the hint + Xoá chữ gốc; while scanning shows the count and Huỷ cancels the job", async ({
    page,
  }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await open(page, chapterId);
    const bar = await openPanel(page, "ocr");
    await expect(bar).toContainText("Kéo khung quanh chữ");
    await expect(bar.getByRole("checkbox", { name: "Xoá chữ gốc" })).toBeChecked();
    await expect(blockPanel(page)).toBeHidden();

    const f = await canvasBox(page);
    const cx = f.x + f.width / 2;
    const cy = f.y + f.height / 2;
    await page.mouse.move(cx - 60, cy - 30);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 6 });
    await page.mouse.up();
    const started = page.waitForResponse((r) => r.url().includes("/ocr-region") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Nhận dạng vùng này" }).click();
    const jobId = ((await (await started).json()) as { job: { id: string } }).job.id;

    // Không có worker → job nằm hàng đợi: thanh báo đang quét + Huỷ.
    await expect(bar.getByText("Đang quét 1 vùng…")).toBeVisible();
    await bar.getByRole("button", { name: "Huỷ", exact: true }).click();
    await expect(bar.getByText(/Đang quét/)).toHaveCount(0);
    await expect
      .poll(async () => ((await (await page.request.get(`/api/jobs/${jobId}`)).json()) as { status: string }).status)
      .toBe("cancelled");
  });

  test("Chữ: dragging a box adds a block, selects it, opens the panel and edits on the image", async ({ page }) => {
    await login(page);
    const { chapterId, pageId } = await readyChapter(page);
    await open(page, chapterId);
    const bar = await openPanel(page, "text");
    await expect(bar).toContainText("Kéo khung trên ảnh");
    const panel = blockPanel(page);
    await expect(panel).toBeHidden();

    const f = await canvasBox(page);
    await page.mouse.move(f.x + f.width / 2 - 80, f.y + 400);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width / 2 + 80, f.y + 460, { steps: 6 });
    await page.mouse.up();
    // Công cụ về Chọn, khối mới được chọn + panel mở + đang sửa chữ ngay trên ảnh.
    await expect(bar).toHaveCount(0);
    await expect(railButton(page, "select")).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: /^Khối \d+\/\d+$/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Sửa chữ" })).toBeVisible();
    await page.keyboard.type("Chữ mới");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(panel.locator("#cw-translation")).toHaveValue("Chữ mới");
    await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Đã lưu", { timeout: 10_000 });
    await expect
      .poll(async () =>
        (
          (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
            state: { text_boxes: { text: string }[] };
          }
        ).state.text_boxes.map((b) => b.text),
      )
      .toContain("Chữ mới");
  });
});

test("page actions moved to the page menu: translate again, drop manual edits (undoable), hide", async ({ page }) => {
  await login(page);
  const { chapterId, pageIds } = await readyChapter(page, 2);
  await open(page, chapterId);

  // Trang chưa sửa tay: không có mục "Bỏ chỉnh sửa tay".
  await pageThumb(page, 1).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Trang 1" });
  await expect(menu.getByRole("menuitem", { name: "Dịch lại trang 1" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Ẩn trang 1" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: /Bỏ chỉnh sửa tay/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Sửa tay trang đang mở → có mục "Bỏ chỉnh sửa tay"; bấm = về bản AI, toast Hoàn tác khôi phục bản sửa.
  await openPanel(page, "table");
  const cell = page.getByLabel("Bản dịch trang 1 vùng 1", { exact: true });
  await cell.fill("Sửa tay");
  await expect(cell).toHaveValue("Sửa tay");
  await pageThumb(page, 1).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Bỏ chỉnh sửa tay trang 1" }).click();
  await expect(cell).toHaveValue("Xin chào");
  const toast = page.locator(".cw-toasts .notice", { hasText: "Đã bỏ chỉnh sửa tay trên trang 1" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(cell).toHaveValue("Sửa tay");
  // Mục này chỉ có cho trang đang mở (state AI nằm trong phiên sửa của nó); trang khác không có.
  await pageThumb(page, 2).click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Trang 2" }).getByRole("menuitem", { name: /Bỏ chỉnh sửa tay/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Dịch lại riêng trang 2 (không phải trang đang mở): gửi đúng page_ids.
  await pageThumb(page, 2).click({ button: "right" });
  const sent = page.waitForRequest(
    (r) => r.url().endsWith(`/chapters/${chapterId}/translate`) && r.method() === "POST",
  );
  await page.getByRole("menuitem", { name: "Dịch lại trang 2" }).click();
  expect(((await sent).postDataJSON() as { page_ids: string[] }).page_ids).toEqual([pageIds[1]]);
  await expect(page.locator(".cw-toasts .notice", { hasText: "Đã xếp dịch lại trang 2" })).toBeVisible();
});

test("a page waiting to be translated offers 'Dịch trang' in its menu", async ({ page }) => {
  await login(page);
  const { chapterId } = await readyChapter(page, 2);
  await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/progress$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { pages: { ord: number; status: string; ocr_ready: boolean }[] };
    const first = body.pages.find((p) => p.ord === 1);
    if (first) {
      first.status = "prepared";
      first.ocr_ready = true;
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await pageThumb(page, 2).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Dịch trang 2", exact: true })).toBeEnabled();
});

test("the raw technical error of a failed page is readable in Hoạt động", async ({ page }) => {
  await login(page);
  const { chapterId } = await readyChapter(page, 2);
  const RAW = "gemini 503: model overloaded {'error': {'code': 503}}";
  await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/progress$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as {
      pages: { ord: number; status: string; job: Record<string, unknown> | null }[];
    };
    const first = body.pages.find((p) => p.ord === 0);
    if (first) {
      first.status = "failed";
      first.job = {
        id: "00000000-0000-4000-8000-000000000001",
        type: "page.prepare",
        status: "failed",
        progress: 0,
        stage: null,
        progress_done: null,
        progress_total: null,
        attempts: 3,
        provider_retries: 0,
        error_class: "provider",
        error: RAW,
        run_after: new Date().toISOString(),
        page_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Thêm thao tác" }).click();
  await page.getByRole("menuitem", { name: /^Hoạt động/ }).click();
  const drawer = page.getByRole("dialog", { name: "Hoạt động" });
  await expect(drawer).toContainText("1 trang lỗi");
  await drawer.getByText("Chi tiết kỹ thuật").click();
  await expect(drawer.getByText(RAW)).toBeVisible();
  await expect(drawer.getByText("Trang 1:")).toBeVisible();
});

test("read-only (second tab): the panel opens on a block but nothing in it is editable", async ({ page, context }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  const b: Box = { x: 300, y: 300, w: 160, h: 60 };
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-one", b)];
  });
  await open(page, chapterId);

  const tabB = await context.newPage();
  await tabB.setViewportSize({ width: 1280, height: 800 });
  await tabB.goto(chapterUrl(chapterId));
  await expect(tabB.getByRole("status", { name: "Khoá chương" })).toContainText("Chỉ xem");
  await expect(tabB.locator(".ed-canvas canvas").first()).toBeVisible();
  await clickBlock(tabB, b);
  const panel = blockPanel(tabB);
  await expect(panel.getByRole("heading", { name: "Khối 1/1" })).toBeVisible();
  await expect(panel.locator("#cw-translation")).toBeDisabled();
  await expect(panel.locator("#ed-font")).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Nhân đôi khối" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Xoá khối" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Dịch lại khối" })).toBeDisabled();
  // Delete trên canvas không xoá được khi chỉ xem.
  await tabB.keyboard.press("Delete");
  await expect(panel.getByRole("heading", { name: "Khối 1/1" })).toBeVisible();
  // Công cụ vẽ bị khoá ở rail.
  await expect(railButton(tabB, "text")).toBeDisabled();
  await expect(railButton(tabB, "brush")).toBeDisabled();
  await expect(railButton(tabB, "ocr")).toBeDisabled();
  await tabB.close();
});

test("a busy page: the block panel shows its text but editing and block actions are off", async ({ page }) => {
  await login(page);
  const { chapterId, pageId } = await readyChapter(page);
  await writeState(page, chapterId, pageId, (s) => {
    s.text_boxes = [textBox("tb-one", { x: 300, y: 300, w: 160, h: 60 })];
  });
  await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/progress$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { pages: { status: string }[] };
    for (const p of body.pages) p.status = "translating";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await openPanel(page, "table");
  await page.locator(".cw-tbody [data-row] .cw-src").first().click();
  const panel = await openPanel(page, "select");
  await expect(panel.getByRole("heading", { name: /^Khối \d+\/\d+$/ })).toBeVisible();
  await expect(panel.locator("#cw-translation")).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Dịch lại khối" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Xoá khối" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Nhân đôi khối" })).toBeDisabled();
});
