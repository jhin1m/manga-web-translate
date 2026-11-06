/**
 * Rail 5 nút (48px, icon + tooltip mở được bằng phím), panel Văn bản 4 tab (giữ nội dung đã mở, Ctrl+F, bảng 4 cột,
 * nhãn Hiệu đính · N) và menu Xuất dưới nút Xuất (đóng bằng Esc / bấm ngoài và trả focus, theo dõi tiếp lượt đang
 * chạy khi mở lại, link hết hạn, nằm gọn trong khung ở 1280x800, mở được từ menu ⋯ khi chương có trang lỗi).
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { apiReadyChapter, docPanel, docTab, login, openPanel, railButton, state, zoomButton } from "./helpers.ts";

test.use({ viewport: { width: 1280, height: 800 } });

const headers = { origin: WEB_URL };
let seq = 9500;
const nextNumber = () => String(++seq);
const chapterUrl = (id: string) => `/s/${state.seriesId}/c/${id}`;

async function open(page: Page, chapterId: string) {
  await page.goto(chapterUrl(chapterId));
  await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
}

async function readyChapter(page: Page) {
  const chapterId = await apiReadyChapter(page, nextNumber());
  const body = (await (await page.request.get(`/api/chapters/${chapterId}/progress`)).json()) as {
    pages: { id: string; ord: number }[];
  };
  const pageId = [...body.pages].sort((a, b) => a.ord - b.ord)[0]?.id ?? "";
  return { chapterId, pageId };
}

const exportMenu = (page: Page) => page.getByRole("dialog", { name: "Xuất chương" });
const exportButton = (page: Page) => page.locator("header.cw-top").getByRole("button", { name: "Xuất", exact: true });

test.describe("rail", () => {
  test("5 icon buttons with names, keyboard tooltip, 48px rail, canvas 1160px wide with nothing selected", async ({
    page,
  }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await open(page, chapterId);

    const rail = page.getByRole("navigation", { name: "Công cụ" });
    const buttons = rail.getByRole("button");
    await expect(buttons).toHaveCount(5);
    for (const name of ["Chọn (V)", "Chữ (T)", "Tẩy chữ (B)", "Quét chữ (R)", "Văn bản (Ctrl+F tìm)"]) {
      const b = rail.getByRole("button", { name, exact: true });
      await expect(b).toBeVisible();
      // Trạng thái bật/tắt nằm ở thuộc tính, không chỉ ở màu.
      await expect(b).toHaveAttribute("aria-pressed", /^(true|false)$/);
      // Không nhãn chữ trên nút: chỉ icon (tooltip ẩn cho tới khi rê chuột / focus).
      await expect(b.locator(".cw-tip")).toBeHidden();
    }
    expect((await rail.boundingBox())?.width).toBe(48);
    const canvas = await page.locator(".ed-canvas").boundingBox();
    expect(canvas?.width).toBe(1160);

    // Tooltip mở bằng phím Tab (focus-visible) và nói tên + phím.
    await page.locator("header.cw-top").getByRole("button", { name: "Xem gốc" }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(".cw-toolbtn:focus-visible");
    for (let i = 0; i < 12 && (await focused.count()) === 0; i++) await page.keyboard.press("Tab");
    await expect(focused).toHaveCount(1);
    const tip = focused.locator(".cw-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/(Chọn|Chữ|Tẩy chữ|Quét chữ|Văn bản)/);
    const tipBox = await tip.boundingBox();
    expect(tipBox?.x).toBeGreaterThanOrEqual(48);

    // Rê chuột cũng hiện tooltip, kèm phím.
    await railButton(page, "brush").hover();
    await expect(railButton(page, "brush").locator(".cw-tip")).toContainText("B");

    // Phím tắt công cụ vẫn chạy.
    await page.locator(".ed-canvas").click({ position: { x: 600, y: 20 } });
    await page.keyboard.press("t");
    await expect(railButton(page, "text")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("b");
    await expect(railButton(page, "brush")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("r");
    await expect(railButton(page, "ocr")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(railButton(page, "text")).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("panel Văn bản", () => {
  test("4 tabs keep their content, Ctrl+F from another tool opens Tìm and focuses the box", async ({ page }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await open(page, chapterId);

    // Đóng mặc định, không nhớ qua tải lại; Ctrl+F khi đang ở công cụ Chữ → tab Tìm / Thay + focus ô tìm.
    await expect(docPanel(page)).toBeHidden();
    await page.locator(".ed-canvas").click({ position: { x: 600, y: 20 } });
    await page.keyboard.press("t");
    await expect(railButton(page, "text")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ControlOrMeta+f");
    const panel = docPanel(page);
    await expect(panel).toBeVisible();
    await expect(docTab(page, "find")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#fr-find")).toBeFocused();
    // Công cụ không đổi; rail báo panel Văn bản đang mở.
    await expect(railButton(page, "doc")).toHaveAttribute("aria-pressed", "true");
    await expect(railButton(page, "text")).toHaveAttribute("aria-pressed", "true");

    // Đủ 4 tab, theo thứ tự.
    await expect(panel.getByRole("tab")).toHaveText(["Bản dịch", "Tìm / Thay", "Glossary", "Hiệu đính"]);

    // Kết quả xem trước nằm lại khi chuyển tab rồi quay về.
    const find = panel.getByRole("group", { name: "Tìm / Thay", exact: true });
    await find.getByLabel("Tìm", { exact: true }).fill("chào");
    await find.getByRole("button", { name: "Xem trước", exact: true }).click();
    await expect(find.getByText("1 chỗ khớp")).toBeVisible();
    await docTab(page, "table").click();
    await expect(panel.getByLabel("Bản dịch trang 1 vùng 1", { exact: true })).toBeVisible();
    await expect(find).toBeHidden();
    await docTab(page, "glossary").click();
    await docTab(page, "find").click();
    await expect(find.getByText("1 chỗ khớp")).toBeVisible();
    await expect(find.getByLabel("Tìm", { exact: true })).toHaveValue("chào");

    // Mũi tên chuyển tab.
    await docTab(page, "find").focus();
    await page.keyboard.press("ArrowRight");
    await expect(docTab(page, "glossary")).toHaveAttribute("aria-selected", "true");
    await expect(docTab(page, "glossary")).toBeFocused();
    await page.keyboard.press("End");
    await expect(docTab(page, "proofread")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(docTab(page, "table")).toHaveAttribute("aria-selected", "true");

    // Bấm lại nút rail thu panel; mở lại vẫn tab đang xem.
    await railButton(page, "doc").click();
    await expect(panel).toBeHidden();
    await railButton(page, "doc").click();
    await expect(docTab(page, "table")).toHaveAttribute("aria-selected", "true");
  });

  test("table has 4 columns (position, source, translation, flag); a row click selects the block", async ({ page }) => {
    await login(page);
    const { chapterId, pageId } = await readyChapter(page);
    // Khối sát mép trái, nằm dưới panel khối nếu không cuộn.
    const left = { x: 8, y: 200, w: 120, h: 60 };
    expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
    const detail = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
      version: number;
      state: { text_boxes: unknown[] };
    };
    detail.state.text_boxes = [
      {
        id: "tb-left",
        region_id: null,
        ...left,
        rotation: 0,
        text: "Khối trái",
        lines: ["Khối trái"],
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
      },
    ];
    const put = await page.request.put(`/api/pages/${pageId}/state`, {
      headers: { ...headers, "if-match": `"${detail.version}"` },
      data: { state: detail.state },
    });
    expect(put.ok()).toBe(true);
    expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
    await open(page, chapterId);

    const panel = await openPanel(page, "table");
    const header = panel.locator(".cw-th > span");
    await expect(header).toHaveCount(4);
    await expect(header.nth(0)).toHaveText("Vị trí");
    await expect(header.nth(1)).toHaveText("Gốc");
    await expect(header.nth(2)).toHaveText("Dịch (sửa tại chỗ)");
    const rows = panel.locator(".cw-tbody [data-row]");
    await expect(rows).toHaveCount(2);
    for (const i of [0, 1]) await expect(rows.nth(i).locator(":scope > span")).toHaveCount(4);
    await expect(rows.nth(1).locator(".num")).toHaveText("1·2");

    // Bấm hàng → khối được chọn (dòng sáng), không thêm panel khối đè lên khi đang ở Văn bản.
    await rows.nth(1).locator(".cw-src").click();
    await expect(rows.nth(1)).toHaveClass(/\bon\b/);
    await expect(page.getByRole("complementary", { name: "Chọn & sửa", exact: true })).toBeHidden();

    // Mở panel khối (đè canvas) khi khối đang chọn nằm sát mép trái: canvas tự cuộn lộ khối ra khỏi panel.
    await zoomButton(page).click();
    await expect(zoomButton(page)).toHaveText("100%");
    await railButton(page, "select").click();
    const block = page.getByRole("complementary", { name: "Chọn & sửa", exact: true });
    await expect(block).toBeVisible();
    const pb = await block.boundingBox();
    if (!pb) throw new Error("no panel");
    const screenX = () =>
      page.evaluate(async (b) => {
        const m = await import(/* @vite-ignore */ "/src/features/editor/store.ts");
        const frame = document.querySelector(".ed-canvas")?.getBoundingClientRect();
        const v = m.editorStore.getState().view;
        return (frame?.x ?? 0) + v.x + b.x * v.scale;
      }, left);
    await expect.poll(screenX).toBeGreaterThanOrEqual(pb.x + pb.width - 1);
  });

  test("the Hiệu đính tab is disabled with a reason while the chapter is not translated", async ({ page }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/progress$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { chapter: { status: string } };
      body.chapter.status = "processing";
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(chapterUrl(chapterId));
    await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
    await railButton(page, "doc").click();
    for (const tab of ["find", "glossary", "proofread"] as const) {
      await expect(docTab(page, tab)).toBeDisabled();
      await expect(docTab(page, tab)).toHaveAttribute("title", /Dùng được khi chương/);
    }
    await expect(docTab(page, "table")).toHaveAttribute("aria-selected", "true");
  });
});

type ExportItem = {
  id: string;
  status: string;
  progress: number;
  stage: string | null;
  error: string | null;
  format: string;
  layout: string;
  quality: number;
  include_untranslated: boolean;
  bytes: number | null;
  created_at: string;
  expires_at: string | null;
  download_url: string | null;
};

const fakeExport = (over: Partial<ExportItem>): ExportItem => ({
  id: "11111111-1111-4111-8111-111111111111",
  status: "succeeded",
  progress: 1,
  stage: null,
  error: null,
  format: "png_zip",
  layout: "original_slices",
  quality: 90,
  include_untranslated: false,
  bytes: 1234,
  created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  download_url: "/api/exports/11111111-1111-4111-8111-111111111111/download",
  ...over,
});

test.describe("menu Xuất", () => {
  test("opens under the button, closes on Esc and outside click, returns focus, stays inside the window", async ({
    page,
  }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await open(page, chapterId);

    const button = exportButton(page);
    await button.click();
    const menu = exportMenu(page);
    await expect(menu).toBeVisible();
    // Drawer đã bỏ: không còn lớp phủ, editor vẫn bấm được phía sau.
    await expect(page.locator(".drawer-scrim")).toHaveCount(0);
    const bb = await button.boundingBox();
    const mb = await menu.boundingBox();
    if (!bb || !mb) throw new Error("no boxes");
    expect(mb.y).toBeGreaterThanOrEqual(bb.y + bb.height);
    expect(Math.abs(mb.x + mb.width - (bb.x + bb.width))).toBeLessThanOrEqual(2);
    expect(mb.y + mb.height).toBeLessThanOrEqual(800);
    // Thứ tự: nút Tải trước, rồi tuỳ chọn thu gọn.
    const dl = menu.getByRole("button", { name: "Tải chương (.zip)", exact: true });
    const opts = menu.getByText("Tuỳ chọn", { exact: true });
    expect((await dl.boundingBox())?.y).toBeLessThan((await opts.boundingBox())?.y ?? 0);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await expect(menu).toBeVisible();
    await page.locator(".ed-canvas").click({ position: { x: 300, y: 300 } });
    await expect(menu).toBeHidden();

    // Bấm lại nút Xuất đang mở thì đóng (không đóng rồi mở lại).
    await button.click();
    await expect(menu).toBeVisible();
    await button.click();
    await expect(menu).toBeHidden();
    await expect(page.getByText("Export")).toHaveCount(0);
  });

  test("a short window scrolls inside the menu instead of overflowing", async ({ page }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await open(page, chapterId);
    await page.setViewportSize({ width: 1280, height: 420 });
    await exportButton(page).click();
    const menu = exportMenu(page);
    await menu.getByText("Tuỳ chọn", { exact: true }).click();
    await menu.getByRole("radio", { name: /\.cbz/ }).check();
    const box = await menu.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(420);
    expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const last = menu.getByLabel("Đưa cả trang chưa dịch vào (ảnh gốc, chưa có bản dịch)");
    await last.scrollIntoViewIfNeeded();
    await last.check();
    await expect(menu.getByText(/gồm trang chưa dịch/)).toBeVisible();
  });

  test("closing while exporting and reopening shows the running progress; chip and Hoạt động still track it", async ({
    page,
  }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    await open(page, chapterId);

    await exportButton(page).click();
    await exportMenu(page).getByRole("button", { name: "Tải chương (.zip)", exact: true }).click();
    const running = exportMenu(page).getByRole("button", { name: /^Đang xuất \d+%/ });
    await expect(running).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(exportMenu(page)).toBeHidden();

    // Tiến độ xuất còn ở chip thanh trên và ở Hoạt động.
    await expect(page.getByRole("status", { name: "Trạng thái chương" })).toContainText("xuất");
    await page.getByRole("button", { name: "Thêm thao tác" }).click();
    await page.getByRole("menuitem", { name: /^Hoạt động/ }).click();
    const activity = page.getByRole("dialog", { name: "Hoạt động" });
    await expect(activity.getByRole("progressbar")).toBeVisible();

    // Huỷ lượt xuất ở Hoạt động → mở lại menu thì nút tải dùng lại được.
    await activity.getByRole("button", { name: "Huỷ", exact: true }).first().click();
    await page.keyboard.press("Escape");
    await expect(activity).toBeHidden();

    // Mở lại khi chưa huỷ xong cũng phải thấy đúng trạng thái; xong thì nút tải mở lại.
    await exportButton(page).click();
    await expect(exportMenu(page).getByRole("button", { name: "Tải chương (.zip)", exact: true })).toBeEnabled({
      timeout: 15_000,
    });
  });

  test("last export shows 'Tải lại'; an expired link says to export again", async ({ page }) => {
    await login(page);
    const { chapterId } = await readyChapter(page);
    let list: ExportItem[] = [fakeExport({})];
    await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/exports$/, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ json: { exports: list } });
    });
    await open(page, chapterId);
    await exportButton(page).click();
    const menu = exportMenu(page);
    await expect(menu).toContainText("Lần trước · 2 giờ trước");
    await expect(menu.getByRole("link", { name: "Tải lại" })).toHaveAttribute("href", /\/api\/exports\/.+\/download$/);
    await page.keyboard.press("Escape");

    // Link hết hạn: nói rõ và nút tải xuất lượt mới.
    list = [fakeExport({ expires_at: new Date(Date.now() - 60_000).toISOString() })];
    await page.reload();
    await expect(page.locator(".ed-canvas canvas").first()).toBeVisible();
    await exportButton(page).click();
    await expect(menu).toContainText("Đã hết hạn");
    await expect(menu.getByRole("link", { name: "Tải lại" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Tải chương (.zip)", exact: true })).toBeEnabled();
  });

  test("from the ⋯ menu when pages failed: same content, aligned under ⋯, focus returns, warnings in one line", async ({
    page,
  }) => {
    await login(page);
    const chapterId = await apiReadyChapter(page, nextNumber(), { pagesPerSource: 3 });
    await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/progress$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as {
        chapter: { status: string };
        counts: Record<string, number>;
        pages: { ord: number; status: string }[];
      };
      body.chapter.status = "partial_failed";
      const sorted = [...body.pages].sort((a, b) => a.ord - b.ord);
      for (const x of sorted.slice(1)) x.status = "failed";
      body.counts = { ready: 1, failed: 2 };
      await route.fulfill({ response: res, json: body });
    });
    await open(page, chapterId);

    const more = page.getByRole("button", { name: "Thêm thao tác" });
    await more.click();
    await page
      .getByRole("menu", { name: "Thêm thao tác" })
      .getByRole("menuitem", { name: "Xuất", exact: true })
      .click();
    const menu = exportMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Tải chương (.zip)", exact: true })).toBeEnabled();
    const mb = await more.boundingBox();
    const bb = await menu.boundingBox();
    if (!mb || !bb) throw new Error("no boxes");
    expect(bb.y).toBeGreaterThanOrEqual(mb.y + mb.height);
    expect(Math.abs(bb.x + bb.width - (mb.x + mb.width))).toBeLessThanOrEqual(2);

    // 1 dòng tóm tắt; bấm mở thì thấy hậu quả cụ thể.
    const warn = menu.getByRole("region", { name: "Trước khi xuất" });
    await expect(warn.locator("summary")).toHaveText(/^!2 chỗ cần xem$/);
    await warn.locator("summary").click();
    await expect(warn).toContainText("2 trang chưa dịch → không có trong file");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});
