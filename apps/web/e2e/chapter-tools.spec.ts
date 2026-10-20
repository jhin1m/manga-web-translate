/**
 * Công cụ màn chương: Tìm & thay (xem trước → áp dụng → hoàn tác), áp glossary (chọn entry → xem trước → áp dụng →
 * hoàn tác), xuất chương (job chapter.export qua worker giả → nút tải → 302 tới presigned GET). Mỗi test dựng một
 * chương 1 trang đã dịch riêng (worker giả) để không phụ thuộc thứ tự test.
 */
import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { type E2EState, STATE_FILE, WEB_URL } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;
const ws = state.workspaceId;
const headers = { origin: WEB_URL };

/** Bản dịch fake worker gán cho vùng t0 (xem fake-worker.ts aiState). */
const FAKE_TRANSLATION = "Xin chào";
const SOURCE_TERM = "안녕하세요";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Mật khẩu").fill(state.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();
}

/** Số chương tăng dần (tái lập được, không đụng dải số ngẫu nhiên của editor.spec). */
let chapterSeq = 3000;

/** Chương 1 trang đã dịch (worker giả) → id chương, id page, số chương. */
async function readyChapter(page: Page) {
  const number = String(++chapterSeq);
  const created = await page.request.post(`/api/w/${ws}/chapters`, {
    headers,
    data: {
      series_id: state.seriesId,
      number,
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  const { chapter, files } = (await created.json()) as {
    chapter: { id: string };
    files: { url: string; fields: Record<string, string> }[];
  };
  const f = files[0];
  if (!f) throw new Error("no upload slot");
  const form = new FormData();
  for (const [k, v] of Object.entries(f.fields)) form.append(k, v);
  form.append("file", new Blob([new Uint8Array(PNG_1PX)], { type: "image/png" }));
  expect((await fetch(f.url, { method: "POST", body: form })).status).toBe(204);
  expect((await page.request.post(`/api/w/${ws}/chapters/${chapter.id}/commit`, { headers, data: {} })).status()).toBe(
    202,
  );

  let pageId: string | null = null;
  const deadline = Date.now() + 30_000;
  let done = false;
  const worker = runFakeWorker(state.token, () => done, 30_000);
  while (!pageId && Date.now() < deadline) {
    const p = (await (await page.request.get(`/api/w/${ws}/chapters/${chapter.id}/progress`)).json()) as {
      pages: { id: string; status: string }[];
    };
    if (p.pages.length && p.pages.every((x) => x.status === "ready")) pageId = p.pages[0]?.id ?? null;
    else await page.waitForTimeout(300);
  }
  done = true;
  await worker;
  if (!pageId) throw new Error("page not ready");
  return { chapterId: chapter.id, pageId, number };
}

async function openChapter(page: Page, chapterId: string) {
  await page.goto(`/w/${ws}/series/${state.seriesId}/chapters/${chapterId}`);
  await expect(page.getByRole("heading", { name: /^Chương / })).toBeVisible();
  // Nút công cụ chỉ hiện khi chương ở trạng thái review/done và có trang.
  await expect(page.getByRole("button", { name: "Tìm & thay", exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Bản dịch vùng đầu tiên của page, đọc thẳng từ API (không qua UI). */
async function regionTranslation(request: APIRequestContext, pageId: string) {
  const r = (await (await request.get(`/api/w/${ws}/pages/${pageId}`)).json()) as {
    state: { regions: { translation: string }[] };
  };
  return r.state.regions[0]?.translation;
}

test.describe("công cụ chương", () => {
  test.setTimeout(120_000);

  test("tìm & thay: xem trước không ghi, áp dụng ghi, hoàn tác khôi phục", async ({ page }) => {
    await login(page);
    const { chapterId, pageId } = await readyChapter(page);
    await openChapter(page, chapterId);

    await page.getByRole("button", { name: "Tìm & thay", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Tìm & thay trong chương" });
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

    await dlg.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(dlg.getByText("Đã hoàn tác trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);
  });

  test("áp glossary: entry không khớp vùng nào thì không áp; entry khớp → áp dụng → hoàn tác", async ({ page }) => {
    await login(page);
    // Glossary series: thuật ngữ nguồn 안녕하세요 → "Chào bạn"; thuật ngữ 없는말 không xuất hiện trong chương.
    for (const body of [
      { source_term: SOURCE_TERM, target_term: "Chào bạn" },
      { source_term: "없는말", target_term: "Điều khác" },
    ]) {
      const r = await page.request.post(`/api/w/${ws}/series/${state.seriesId}/glossary`, { headers, data: body });
      expect(r.status()).toBe(201);
    }
    const { chapterId, pageId } = await readyChapter(page);
    await openChapter(page, chapterId);

    await page.getByRole("button", { name: "Áp glossary", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Áp glossary vào bản dịch" });
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

    await dlg.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(dlg.getByText("Đã hoàn tác trên 1 trang.")).toBeVisible();
    await expect.poll(() => regionTranslation(page.request, pageId)).toBe(FAKE_TRANSLATION);
  });

  test("xuất chương: job qua worker giả → nút tải → 302 tới presigned GET có tên file", async ({ page }) => {
    await login(page);
    const { chapterId, number } = await readyChapter(page);
    await openChapter(page, chapterId);

    let exportDone = false;
    const worker = runFakeWorker(state.token, () => exportDone, 90_000);

    await page.getByRole("button", { name: "Xuất chương", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Xuất chương" });
    await dlg.getByRole("button", { name: "Xuất", exact: true }).click();

    const row = dlg.locator(".status", { hasText: "Xong" });
    await expect(row).toBeVisible({ timeout: 60_000 });
    exportDone = true;
    await worker;

    const link = dlg.getByRole("link", { name: "Tải xuống" });
    await expect(link).toHaveAttribute("download", "");
    const href = await link.getAttribute("href");
    expect(href).toMatch(new RegExp(`^/api/w/${ws}/exports/[0-9a-f-]{36}/download$`));
    const exportId = href?.split("/")[5] ?? "";

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
    const api = (await (await page.request.get(`/api/w/${ws}/exports/${exportId}`)).json()) as {
      status: string;
      bytes: number;
      download_url: string | null;
    };
    expect(api.status).toBe("succeeded");
    expect(api.bytes).toBe(body.byteLength);
    expect(api.download_url).toBe(href);
  });
});
