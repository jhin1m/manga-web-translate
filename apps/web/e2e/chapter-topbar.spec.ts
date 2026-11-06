/**
 * Thanh trên màn chương: chip trạng thái là nút (nhảy tới trang cần xem kế tiếp qua luồng đổi trang thường — lưu
 * trước, vòng lại từ đầu — hoặc mở Hoạt động), Hoạt động luôn mở được từ menu ⋯, đang chạy chỉ có một nút Huỷ + vạch
 * 2px, có trang lỗi thì nút chính "Chạy lại N trang" và "Xuất" nằm trong menu ⋯, không còn chữ "Export", thanh trên
 * không quá 8 mục ở 1280. Tiến độ chương giả bằng cách sửa phản hồi /progress (worker giả không tạo được trang lỗi).
 */
import { expect, type Page, test } from "@playwright/test";
import { apiReadyChapter, login, openPanel, state } from "./helpers.ts";

test.use({ viewport: { width: 1280, height: 800 } });

type ProgressBody = {
  chapter: { status: string; run: unknown };
  counts: Record<string, number>;
  pages: { id: string; ord: number; status: string; ai_update_available: boolean }[];
};

/** Sửa phản hồi tiến độ của chương trước khi màn chương nhận. */
async function fakeProgress(page: Page, edit: (p: ProgressBody) => void) {
  await page.route(/\/api\/chapters\/[0-9a-f-]{36}\/progress$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as ProgressBody;
    edit(body);
    await route.fulfill({ response: res, json: body });
  });
}

const top = (page: Page) => page.locator("header.cw-top");
const chipButton = (page: Page) => page.getByRole("status", { name: "Trạng thái chương" }).getByRole("button");
const chapterNumber = (seed: number) => String(9300 + seed);

async function expectNoExportWord(page: Page) {
  const hits = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("*")) {
      for (const a of ["aria-label", "title", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v && /\bExport\b/.test(v)) out.push(`${a}=${v}`);
      }
    }
    if (/\bExport\b/.test(document.body.innerText)) out.push("text");
    return out;
  });
  expect(hits).toEqual([]);
}

/** Mục bấm được trực tiếp trên thanh trên (liên kết + nút). */
const controls = (page: Page) => top(page).locator("a:visible, button:visible");

test("chip jumps to the next page that needs review, saving the open page first and wrapping around", async ({
  page,
}) => {
  await login(page);
  const chapterId = await apiReadyChapter(page, chapterNumber(1), { pagesPerSource: 3 });
  let flagged: string[] = [];
  await fakeProgress(page, (p) => {
    const sorted = [...p.pages].sort((a, b) => a.ord - b.ord);
    flagged = sorted.slice(1).map((x) => x.id);
    for (const x of sorted.slice(1)) x.ai_update_available = true;
  });
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);

  await expect(chipButton(page)).toContainText("2 cần xem");
  await expect(chipButton(page)).toHaveAttribute("aria-label", /nhảy tới trang cần xem/);

  // Sửa dở trang 1 rồi bấm chip ngay: trang 1 được lưu trước khi sang trang 2.
  await openPanel(page, "table");
  const cell = page.getByLabel("Bản dịch trang 1 vùng 1", { exact: true });
  await cell.click();
  await cell.fill("Chữ sửa dở");
  await chipButton(page).click();
  const pageIdOf = (n: number) => flagged[n - 2] ?? "";
  await expect(page).toHaveURL(new RegExp(`page=${pageIdOf(2)}`));
  const first = (await (await page.request.get(`/api/chapters/${chapterId}/progress`)).json()) as ProgressBody;
  const p1 = first.pages.find((p) => p.ord === 0)?.id ?? "";
  await expect
    .poll(async () => {
      const r = (await (await page.request.get(`/api/pages/${p1}`)).json()) as {
        state: { regions: { translation: string }[] };
      };
      return r.state.regions[0]?.translation;
    })
    .toBe("Chữ sửa dở");

  await chipButton(page).click();
  await expect(page).toHaveURL(new RegExp(`page=${pageIdOf(3)}`));
  // Trang cuối → vòng lại, bỏ qua trang 1 (không cần xem).
  await chipButton(page).click();
  await expect(page).toHaveURL(new RegExp(`page=${pageIdOf(2)}`));
});

test("chip opens Hoạt động when no page needs review; the menu always has Hoạt động", async ({ page }) => {
  await login(page);
  const chapterId = await apiReadyChapter(page, chapterNumber(2));
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);

  await expect(chipButton(page)).toHaveAttribute("aria-label", /mở Hoạt động/);
  await chipButton(page).click();
  const activity = page.getByRole("dialog", { name: "Hoạt động" });
  await expect(activity).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(activity).toBeHidden();

  await page.getByRole("button", { name: "Thêm thao tác" }).click();
  await page.getByRole("menuitem", { name: /^Hoạt động/ }).click();
  await expect(activity).toBeVisible();
});

test("status area is a live region that stays in the DOM and is silent when there is nothing to say", async ({
  page,
}) => {
  await login(page);
  const chapterId = await apiReadyChapter(page, chapterNumber(3));
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);

  const access = page.getByRole("status", { name: "Khoá chương" });
  await expect(access).toContainText("Bạn đang giữ khoá chương");
  // Bình thường không có chữ nào hiện ở chỗ đó.
  await expect(top(page).locator(".cw-edit")).toHaveCount(0);
  await expect(top(page).getByText("Đã lưu", { exact: true })).toHaveCount(0);

  // Sửa → "Chưa lưu"/"Đang lưu…" hiện rồi biến mất khi lưu xong; vùng live vẫn là cùng phần tử.
  await openPanel(page, "table");
  const cell = page.getByLabel("Bản dịch trang 1 vùng 1", { exact: true });
  await cell.click();
  await cell.fill("Thử lưu");
  await expect(access).toContainText("Đã lưu", { timeout: 10_000 });
  await expect(top(page).locator(".cw-edit")).toHaveCount(0);
});

test("failed pages: primary re-runs N pages, Xuất moves into the menu, no 'Export' wording, ≤ 8 items", async ({
  page,
}) => {
  await login(page);
  const chapterId = await apiReadyChapter(page, chapterNumber(4), { pagesPerSource: 3 });
  await fakeProgress(page, (p) => {
    p.chapter.status = "partial_failed";
    const sorted = [...p.pages].sort((a, b) => a.ord - b.ord);
    for (const x of sorted.slice(1)) x.status = "failed";
    p.counts = { ready: 1, failed: 2 };
  });
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);

  await expect(chipButton(page)).toContainText("Lỗi 2 trang");
  await expect(top(page).getByRole("button", { name: "Chạy lại 2 trang", exact: true })).toBeVisible();
  await expect(top(page).getByRole("button", { name: "Xuất", exact: true })).toHaveCount(0);
  expect(await controls(page).count()).toBeLessThanOrEqual(8);

  await page.getByRole("button", { name: "Thêm thao tác" }).click();
  const menu = page.getByRole("menu", { name: "Thêm thao tác" });
  await expect(menu.getByRole("menuitem", { name: "Xuất", exact: true })).toBeVisible();
  await expectNoExportWord(page);
  await menu.getByRole("menuitem", { name: "Xuất", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Xuất chương" })).toBeVisible();
  await expectNoExportWord(page);
});

test("running: a single Huỷ button and a 2px progress bar", async ({ page }) => {
  await login(page);
  const chapterId = await apiReadyChapter(page, chapterNumber(5), { pagesPerSource: 3 });
  await fakeProgress(page, (p) => {
    p.chapter.status = "processing";
    p.chapter.run = { target: "translated", total: 12, remaining: 9, batch: 1, batches: 3 };
    p.counts = { ready: 1, translating: 2 };
    for (const x of p.pages) if (x.ord > 0) x.status = "translating";
  });
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);

  await expect(chipButton(page)).toContainText("Đang dịch · 3/12 trang");
  const cancel = top(page).getByRole("button", { name: "Huỷ", exact: true });
  await expect(cancel).toBeVisible();
  await expect(top(page).getByRole("button", { name: /Xuất|Export/ })).toHaveCount(0);
  await expect(top(page).getByRole("button", { name: /^Hoạt động/ })).toHaveCount(0);
  const bar = top(page).locator(".cw-progress");
  await expect(bar).toHaveCSS("height", "2px");
  const width = await bar.evaluate((el) => el.getBoundingClientRect().width);
  const total = await top(page).evaluate((el) => el.getBoundingClientRect().width);
  expect(width / total).toBeCloseTo(0.25, 1);
  expect(await controls(page).count()).toBeLessThanOrEqual(8);
});

test("done: Xuất is the primary button and the lang pair lives in the chapter popover", async ({ page }) => {
  await login(page);
  const chapterId = await apiReadyChapter(page, chapterNumber(6));
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);

  await expect(top(page).getByRole("button", { name: "Xuất", exact: true })).toBeEnabled();
  await expect(top(page).getByRole("button", { name: "Hoàn tác (Ctrl+Z)" })).toBeVisible();
  const title = top(page).getByRole("heading").getByRole("button");
  await expect(title).toHaveText(new RegExp(`^Ch\\.${chapterNumber(6)}`));
  await expect(title).toHaveAccessibleName(new RegExp(`^Chương ${chapterNumber(6)}`));
  expect(await controls(page).count()).toBeLessThanOrEqual(8);

  await title.click();
  const dlg = page.getByRole("dialog", { name: /Đổi series/ });
  await expect(dlg.getByLabel("Ngôn ngữ gốc (chữ trên ảnh)")).toBeVisible();
  await expect(dlg.getByLabel("Dịch sang")).toBeVisible();
  // Chưa đổi gì → chưa lưu được; đổi ngôn ngữ đích rồi lưu → PATCH series.
  await expect(dlg.getByRole("button", { name: "Lưu", exact: true })).toBeDisabled();
  await dlg.getByLabel("Dịch sang").selectOption("en");
  const patched = page.waitForResponse((r) => r.url().includes("/api/series/") && r.request().method() === "PATCH");
  await dlg.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await patched).status()).toBe(200);
  await expect(dlg).toBeHidden();
  const s = (await (await page.request.get(`/api/series/${state.seriesId}`)).json()) as { target_lang: string };
  expect(s.target_lang).toBe("en");
  // Trả lại để spec khác không bị ảnh hưởng.
  await title.click();
  await page.getByLabel("Dịch sang").selectOption("vi");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Đổi series/ })).toBeHidden();
});
