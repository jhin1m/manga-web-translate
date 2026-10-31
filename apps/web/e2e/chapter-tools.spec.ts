/**
 * Công cụ màn chương: Tìm & thay (xem trước → áp dụng → hoàn tác), áp glossary (chọn entry → xem trước → áp dụng →
 * hoàn tác) — cả hai ở panel "Tìm" của rail công cụ (segmented), không hộp thoại; sau áp dụng panel Bản dịch hiện
 * chữ mới không cần tải lại, không PUT nào bị 423. Xuất chương qua drawer "Xuất chương" (job chapter.export qua
 * worker giả → nút tải → 302 tới presigned GET; Esc đóng, focus về nút Xuất). Ẩn / khôi phục trang qua menu chuột
 * phải ở cột thumbnail. Mỗi test dựng một chương đã dịch riêng (worker giả) để không phụ thuộc thứ tự test.
 */
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import {
  login,
  openFind,
  openPanel,
  pageThumb,
  pageThumbs,
  railButton,
  state,
  translateIfPrepared,
} from "./helpers.ts";

const headers = { origin: WEB_URL };

/** Bản dịch fake worker gán cho vùng t0 (xem fake-worker.ts aiState). */
const FAKE_TRANSLATION = "Xin chào";
const SOURCE_TERM = "안녕하세요";

/** Số chương tăng dần (tái lập được, không đụng dải số ngẫu nhiên của editor.spec). */
let chapterSeq = 3000;

/** Chương `n` trang (mặc định 1) đã dịch (worker giả) → id chương, id page đầu, số chương. */
async function readyChapter(page: Page, n = 1) {
  const number = String(++chapterSeq);
  const created = await page.request.post(`/api/chapters`, {
    headers,
    data: {
      series_id: state.seriesId,
      number,
      files: Array.from({ length: n }, (_, i) => ({
        name: `${i + 1}.png`,
        content_type: "image/png",
        bytes: PNG_1PX.length,
      })),
    },
  });
  expect(created.status()).toBe(201);
  const { chapter, files } = (await created.json()) as {
    chapter: { id: string };
    files: { url: string; fields: Record<string, string> }[];
  };
  if (files.length !== n) throw new Error("no upload slot");
  for (const f of files) {
    const form = new FormData();
    for (const [k, v] of Object.entries(f.fields)) form.append(k, v);
    form.append("file", new Blob([new Uint8Array(PNG_1PX)], { type: "image/png" }));
    expect((await fetch(f.url, { method: "POST", body: form })).status).toBe(204);
  }
  expect((await page.request.post(`/api/chapters/${chapter.id}/commit`, { headers, data: {} })).status()).toBe(202);

  let pageId: string | null = null;
  const deadline = Date.now() + 30_000;
  let done = false;
  const worker = runFakeWorker(state.token, () => done, 30_000);
  while (!pageId && Date.now() < deadline) {
    const p = (await (await page.request.get(`/api/chapters/${chapter.id}/progress`)).json()) as {
      chapter: { status: string };
      pages: { id: string; status: string }[];
    };
    await translateIfPrepared(page, chapter.id, p.chapter.status);
    if (p.pages.length && p.pages.every((x) => x.status === "ready")) pageId = p.pages[0]?.id ?? null;
    else await page.waitForTimeout(300);
  }
  done = true;
  await worker;
  if (!pageId) throw new Error("page not ready");
  return { chapterId: chapter.id, pageId, number };
}

async function openChapter(page: Page, chapterId: string) {
  await page.goto(`/s/${state.seriesId}/c/${chapterId}`);
  await expect(page.getByRole("heading", { name: /^Chương / })).toBeVisible();
  // Panel Tìm chỉ bật khi chương ở trạng thái review/done và có trang.
  await expect(railButton(page, "find")).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole("status", { name: "Khoá chương" })).toContainText("Bạn đang giữ khoá chương");
}

/** Ô Dịch trang 1 vùng 1 của bảng văn bản (panel Bản dịch). */
async function tableCell(page: Page) {
  await openPanel(page, "table");
  return page.getByLabel("Bản dịch trang 1 vùng 1", { exact: true });
}

/** Ghi lại PUT state bị 423 (mất khoá) trong suốt test. */
function watchLocked(page: Page) {
  const locked: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PUT" && r.url().endsWith("/state") && r.status() === 423) locked.push(r.url());
  });
  return locked;
}

/** Bản dịch vùng đầu tiên của page, đọc thẳng từ API (không qua UI). */
async function regionTranslation(request: APIRequestContext, pageId: string) {
  const r = (await (await request.get(`/api/pages/${pageId}`)).json()) as {
    state: { regions: { translation: string }[] };
  };
  return r.state.regions[0]?.translation;
}

test.describe("công cụ chương", () => {
  test.setTimeout(120_000);

  test("tìm & thay: xem trước không ghi, áp dụng ghi, hoàn tác khôi phục", async ({ page }) => {
    await login(page);
    const { chapterId, pageId } = await readyChapter(page);
    const locked = watchLocked(page);
    await openChapter(page, chapterId);
    await expect(await tableCell(page)).toHaveValue(FAKE_TRANSLATION);

    const dlg = await openFind(page, "Tìm / Thay");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await dlg.getByLabel("Tìm", { exact: true }).fill("chào");
    await dlg.getByLabel("Thay bằng", { exact: true }).fill("Hello");

    await dlg.getByRole("button", { name: "Xem trước", exact: true }).click();
    await expect(dlg.getByText("1 chỗ khớp")).toBeVisible();
    await expect(dlg.locator("table.data tbody tr")).toHaveCount(1);
    await expect(dlg.locator("table.data tbody tr").getByText("Vùng")).toBeVisible();
    // Xem trước không được ghi: bản dịch vẫn nguyên.
    expect(await regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);

    await dlg.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await expect(dlg.getByText("Đã thay 1 chỗ trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe("Xin Hello");
    // Bản xem trước đã áp → không áp lại được (áp lần 2 từng tạo batch rỗng làm mất "Hoàn tác" của lần thật).
    await expect(dlg.getByRole("button", { name: "Áp dụng", exact: true })).toBeDisabled();
    // Bảng văn bản cập nhật không cần tải lại (page đang sửa nạp lại bản server mới).
    await expect(await tableCell(page)).toHaveValue("Xin Hello");

    // Bấm kết quả → nhảy tới khối (dòng hiện tại của bảng + panel Chọn), panel Tìm vẫn mở.
    await openFind(page, "Tìm / Thay");
    await dlg.getByRole("button", { name: "Tới khối", exact: true }).click();
    await expect(railButton(page, "find")).toHaveAttribute("aria-pressed", "true");
    await expect(dlg).toBeVisible();
    await tableCell(page);
    await expect(page.locator(`[data-row="${pageId}:t0"]`)).toHaveClass(/\bon\b/);
    await expect(await openPanel(page, "select")).toContainText("Khối 1 / 1 · Thoại");

    await openFind(page, "Tìm / Thay");
    await dlg.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(dlg.getByText("Đã hoàn tác trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);
    await expect(await tableCell(page)).toHaveValue(FAKE_TRANSLATION);
    expect(locked).toEqual([]);
  });

  test("tìm & thay: Cmd+Z hoàn tác cả lượt như nút Hoàn tác, Cmd+Z tiếp lùi sửa trước lượt", async ({ page }) => {
    await login(page);
    const { chapterId, pageId } = await readyChapter(page);
    await openChapter(page, chapterId);
    // Sửa trước lượt ở trang đang mở (vào lịch sử undo của editor), đợi autosave ghi lên server.
    const cell = await tableCell(page);
    await cell.fill("Xin chào!");
    await cell.blur();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe("Xin chào!");

    const dlg = await openFind(page, "Tìm / Thay");
    await dlg.getByLabel("Tìm", { exact: true }).fill("chào");
    await dlg.getByLabel("Thay bằng", { exact: true }).fill("Hello");
    await dlg.getByRole("button", { name: "Xem trước", exact: true }).click();
    await dlg.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await expect(dlg.getByText("Đã thay 1 chỗ trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe("Xin Hello!");
    await expect(await tableCell(page)).toHaveValue("Xin Hello!");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Cmd+Z đang gõ trong ô Tìm vẫn là undo gốc của ô (không đụng lượt).
    await openFind(page, "Tìm / Thay");
    await dlg.getByLabel("Tìm", { exact: true }).focus();
    const undoCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/find-replace/undo")) undoCalls.push(r.url());
    });
    await page.keyboard.press("ControlOrMeta+z");
    // Hoàn tác là bất đồng bộ: đợi đủ lâu để một lần gọi sai kịp xảy ra rồi mới khẳng định không có gì thay đổi.
    await page.waitForTimeout(1500);
    expect(undoCalls).toEqual([]);
    expect(await regionTranslation(page.request, pageId)).toBe("Xin Hello!");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Lượt là bước cuối → Cmd+Z hoàn tác cả lượt; nút Hoàn tác của panel không còn treo.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".cw-toasts .notice", { hasText: "Đã hoàn tác thay thế trên 1 trang" })).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe("Xin chào!");
    await expect(dlg.getByRole("button", { name: "Hoàn tác", exact: true })).toHaveCount(0);

    // Cmd+Z tiếp theo hoàn tác sửa trước lượt trên trang đang mở.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);
    await expect(await tableCell(page)).toHaveValue(FAKE_TRANSLATION);
  });

  test("áp glossary: entry không khớp vùng nào thì không áp; entry khớp → áp dụng → hoàn tác", async ({ page }) => {
    await login(page);
    // Glossary series: thuật ngữ nguồn 안녕하세요 → "Chào bạn"; thuật ngữ 없는말 không xuất hiện trong chương.
    for (const body of [
      { source_term: SOURCE_TERM, target_term: "Chào bạn" },
      { source_term: "없는말", target_term: "Điều khác" },
    ]) {
      const r = await page.request.post(`/api/series/${state.seriesId}/glossary`, { headers, data: body });
      expect(r.status()).toBe(201);
    }
    const { chapterId, pageId } = await readyChapter(page);
    const locked = watchLocked(page);
    await openChapter(page, chapterId);

    const dlg = await openFind(page, "Glossary");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(dlg.getByLabel("Chọn 안녕하세요", { exact: true })).toBeVisible();

    // (1) Thuật ngữ không có trong chữ gốc vùng nào → không khớp, không cho áp dụng.
    await dlg.getByLabel("Chọn 없는말", { exact: true }).check();
    await dlg.getByLabel("Cụm cũ của 없는말", { exact: true }).fill(FAKE_TRANSLATION);
    await dlg.getByRole("button", { name: "Xem trước", exact: true }).click();
    await expect(dlg.getByText("Không có chỗ nào khớp.")).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Áp dụng", exact: true })).toBeDisabled();

    // (2) Đổi sang thuật ngữ có trong chữ gốc, cụm cũ = bản dịch hiện tại → khớp 1 chỗ.
    await dlg.getByLabel("Chọn 없는말", { exact: true }).uncheck();
    await dlg.getByLabel("Chọn 안녕하세요", { exact: true }).check();
    await dlg.getByLabel("Cụm cũ của 안녕하세요", { exact: true }).fill(FAKE_TRANSLATION);
    await dlg.getByRole("button", { name: "Xem trước", exact: true }).click();
    await expect(dlg.getByText("1 chỗ khớp")).toBeVisible();
    await expect(dlg.locator("table.data tbody tr").getByText(/quy tắc 1/)).toBeVisible();
    expect(await regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);

    await dlg.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await expect(dlg.getByText("Đã thay 1 chỗ trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe("Chào bạn");
    await expect(await tableCell(page)).toHaveValue("Chào bạn");

    await openFind(page, "Glossary");
    await dlg.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(dlg.getByText("Đã hoàn tác trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);
    expect(locked).toEqual([]);
  });

  test("xuất chương: job qua worker giả → nút tải → 302 tới presigned GET có tên file", async ({ page }) => {
    await login(page);
    const { chapterId, number } = await readyChapter(page);
    await openChapter(page, chapterId);

    let exportDone = false;
    const worker = runFakeWorker(state.token, () => exportDone, 90_000);

    // "Xuất lại" ở home mở chương với `?drawer=export` → drawer mở sẵn.
    await page.goto(`/s/${state.seriesId}/c/${chapterId}?drawer=export`);
    await expect(page.getByRole("dialog", { name: "Export chương" })).toBeVisible();
    await expect(page).not.toHaveURL(/drawer=export/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Export chương" })).toBeHidden();

    // Drawer Xuất (editor vẫn ở phía sau): tên file khớp tên server đặt khi tải.
    const open = page.getByRole("button", { name: "Export", exact: true });
    await open.click();
    const dlg = page.getByRole("dialog", { name: "Export chương" });
    await expect(dlg.getByText(`Series e2e-ch${number}.zip`)).toBeVisible();
    // 1 lần bấm: xong thì tự tải (đúng tên file server đặt); link "Tải xuống" tại chỗ phòng trình duyệt chặn.
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await dlg.getByRole("button", { name: "Tải chương (.zip)", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`Series e2e-ch${number}.zip`);
    exportDone = true;
    await worker;

    const link = dlg.getByRole("link", { name: "Tải xuống" });
    await expect(link).toHaveAttribute("download", "");
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/api\/exports\/[0-9a-f-]{36}\/download$/);
    const exportId = href?.split("/")[3] ?? "";

    // Không follow redirect: phải 302 tới presigned GET 5' kèm Content-Disposition attachment.
    const r = await page.request.get(href as string, { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    const location = r.headers().location ?? "";
    expect(location).toContain("X-Amz-Signature=");
    const disposition = new URL(location).searchParams.get("response-content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(`filename*=UTF-8''Series%20e2e-ch${number}.zip`);

    // Presigned URL tải được và đúng kích thước server đã đo; file là zip (PK).
    const file = await page.request.get(location);
    expect(file.status()).toBe(200);
    const body = await file.body();
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
    const api = (await (await page.request.get(`/api/exports/${exportId}`)).json()) as {
      status: string;
      bytes: number;
      download_url: string | null;
    };
    expect(api.status).toBe("succeeded");
    expect(api.bytes).toBe(body.byteLength);
    expect(api.download_url).toBe(href);

    // Esc đóng drawer, focus về nút Xuất.
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(open).toBeFocused();
  });
});

test("hide a page from the thumbnail column (undo, then restore from its menu)", async ({ page }) => {
  await login(page);
  const { chapterId } = await readyChapter(page, 3);
  await openChapter(page, chapterId);
  const thumbs = pageThumbs(page);
  await expect(thumbs.getByText("3 trang", { exact: true })).toBeVisible();

  // Chuột phải thumbnail → menu; Esc đóng, focus về thumbnail.
  await pageThumb(page, 2).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Ẩn trang 2" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(pageThumb(page, 2)).toBeFocused();
  // Tab trong menu: đóng menu, focus đi tiếp (không rơi về <body>).
  await pageThumb(page, 2).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Ẩn trang 2" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("body")).not.toBeFocused();
  // Chuột phải thumbnail → "Ẩn trang 2".
  await pageThumb(page, 2).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ẩn trang 2" }).click();
  await expect(thumbs.getByText("2 trang", { exact: true })).toBeVisible();
  // Số trang giữ số gốc; trang ẩn nằm đúng chỗ, mờ + "Đã ẩn".
  await expect(thumbs.getByRole("button", { name: /^Trang \d · / })).toHaveCount(3);
  await expect(thumbs.getByRole("button", { name: "Trang 2 · Đã ẩn", exact: true })).toBeVisible();
  await expect(pageThumb(page, 1)).not.toHaveAccessibleName(/Đã ẩn/);
  await expect(pageThumb(page, 3)).not.toHaveAccessibleName(/Đã ẩn/);
  // "Hoàn tác" của thông báo (thanh trên cũng có nút Hoàn tác).
  await page.getByRole("status").filter({ hasText: "Đã ẩn trang 2" }).getByRole("button", { name: "Hoàn tác" }).click();
  await expect(thumbs.getByText("3 trang", { exact: true })).toBeVisible();
  await expect(thumbs.getByRole("button", { name: /Đã ẩn/ })).toHaveCount(0);

  // Ẩn lại bằng bàn phím (Shift+F10 trên thumbnail đang focus), rồi bấm trang ẩn → menu "Khôi phục trang 2".
  await pageThumb(page, 2).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Ẩn trang 2" }).click();
  await thumbs.getByRole("button", { name: "Trang 2 · Đã ẩn", exact: true }).click();
  await page.getByRole("menuitem", { name: "Khôi phục trang 2" }).click();
  await expect(thumbs.getByText("3 trang", { exact: true })).toBeVisible();
  await expect(thumbs.getByRole("button", { name: /Đã ẩn/ })).toHaveCount(0);

  // Nút góc thumbnail (hiện khi rê chuột): xoá rồi khôi phục không qua menu.
  await pageThumb(page, 3).hover();
  await thumbs.getByRole("button", { name: "Xoá (ẩn) trang 3" }).click();
  await expect(thumbs.getByRole("button", { name: "Trang 3 · Đã ẩn", exact: true })).toBeVisible();
  await thumbs.getByRole("button", { name: "Khôi phục trang 3" }).click();
  await expect(thumbs.getByText("3 trang", { exact: true })).toBeVisible();
  await expect(thumbs.getByRole("button", { name: /Đã ẩn/ })).toHaveCount(0);
});
