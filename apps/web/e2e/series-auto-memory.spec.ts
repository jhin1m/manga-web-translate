/**
 * AI tự ghi trí nhớ series khi dịch: thuật ngữ vào glossary, cặp xưng hô mới, Giọng văn (khi còn trống) — có chip
 * "AI", không còn gợi ý Nhận / Bỏ. Sửa mục AI thì chip mất; mục AI đã xoá không quay lại. Lưu Cài đặt dịch chỉ gửi
 * trường đã đổi nên không đè mục AI ghi trong lúc form đang mở.
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { apiCommitChapter, apiReadyChapter, login, runUntilReady } from "./helpers.ts";

const headers = { origin: WEB_URL };
const AI_TITLE = "AI tự thêm khi dịch — sửa để xác nhận";
const STYLE = "Giọng trẻ, đời thường";
const learned = {
  new_terms: [
    { source: "민준", target: "Minjun", kind: "person" as const },
    { source: "검성", target: "Kiếm Thánh", kind: "term" as const },
  ],
  pronoun_pairs: [{ speaker: "Minjun", listener: "Seoyeon", address: "anh/em" }],
  style_note: STYLE,
};

type SeriesView = {
  honorific_policy: string;
  style_prompt: string;
  style_origin: string | null;
  pronoun_rules: { speaker: string; listener: string; address: string; origin: string }[];
};

/**
 * Series dạng từng trang: commit dịch luôn tới `ready`. Dạng strip dừng ở `prepared`, detail series ngừng poll ở đó
 * nên trang có thể không bao giờ thấy phần AI vừa ghi.
 */
async function apiSeries(page: Page, data: Record<string, unknown>) {
  const created = await page.request.post("/api/series", { headers, data: { page_format: "pages", ...data } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

const getSeries = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/series/${id}`)).json()) as SeriesView;

/** Nhóm thu gọn theo tên ở `<summary>` (tên có thể kèm chip AI). */
const fold = (page: Page, title: string) =>
  page
    .getByRole("dialog", { name: "Cài đặt dịch" })
    .locator("details.settings-fold")
    .filter({ has: page.locator("summary .fold-title", { hasText: title }) });

test("terms, pronoun pairs and style written by AI show an AI tag; edited tags drop, deleted terms stay gone", async ({
  page,
}) => {
  await login(page);
  const seriesId = await apiSeries(page, { title: "Trí nhớ AI e2e" });
  try {
    const main = page.getByRole("main");
    // Đứng ở màn series (chương đang ingest → detail poll) lúc chương dịch xong.
    const chapterId = await apiCommitChapter(page, "1", seriesId);
    await page.goto(`/s/${seriesId}`);
    await expect(main.getByRole("link", { name: "Glossary · 0" })).toBeVisible();
    await runUntilReady(page, chapterId, { learned });
    // Glossary không poll: số mục đổi nhờ glossary_rev của detail series.
    await expect(main.getByRole("link", { name: "Glossary · 2" })).toBeVisible({ timeout: 15_000 });

    await main.getByRole("link", { name: "Glossary · 2" }).click();
    const glossary = page.getByRole("dialog", { name: "Glossary của series" });
    const minjun = glossary.getByRole("row").filter({ hasText: "민준" });
    const kiem = glossary.getByRole("row").filter({ hasText: "검성" });
    // Chip tách khỏi thuật ngữ bằng dấu cách, phần giải thích có cho trình đọc màn hình.
    await expect(minjun.getByRole("cell").first()).toHaveText(/^민준 AI/);
    await expect(minjun.getByTitle(AI_TITLE)).toContainText("AI tự thêm khi dịch");
    await expect(kiem.getByTitle(AI_TITLE)).toBeVisible();
    await expect(glossary.getByText(/Gợi ý từ AI/)).toHaveCount(0);
    await expect(glossary.getByRole("button", { name: /^(Nhận|Bỏ) / })).toHaveCount(0);

    // Sửa entry AI → chip mất; xoá entry AI còn lại.
    await minjun.getByRole("button", { name: "Sửa" }).click();
    await glossary.getByLabel("Bản dịch", { exact: true }).fill("Min-jun");
    await glossary.getByRole("button", { name: "Lưu", exact: true }).click();
    const edited = glossary.getByRole("row").filter({ hasText: "Min-jun" });
    await expect(edited).toBeVisible();
    await expect(edited.getByTitle(AI_TITLE)).toHaveCount(0);
    await kiem.getByRole("button", { name: "Xoá" }).click();
    await expect(kiem).toHaveCount(0);
    await glossary.getByRole("button", { name: "Đóng" }).click();

    // Cài đặt dịch: cặp xưng hô + Giọng văn có chip; không còn gợi ý. Lưu ngay không đổi gì → đóng, không gọi PATCH.
    await main.getByRole("link", { name: "Cài đặt dịch" }).click();
    const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
    const style = fold(page, "Giọng văn");
    await expect(style.locator("summary").getByTitle(AI_TITLE)).toBeVisible();
    await expect(style.locator("summary")).toContainText(STYLE);
    const pronouns = fold(page, "Xưng hô");
    await pronouns.locator("summary").click();
    await expect(pronouns.locator("tbody tr")).toHaveCount(1);
    await expect(pronouns.locator("tbody tr").first().getByTitle(AI_TITLE)).toBeVisible();
    await expect(settings.getByText(/Gợi ý từ AI/)).toHaveCount(0);
    await expect(settings.getByRole("button", { name: /^(Nhận|Bỏ) / })).toHaveCount(0);
    let patched = 0;
    page.on("request", (r) => r.method() === "PATCH" && r.url().includes(`/api/series/${seriesId}`) && patched++);
    await settings.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(settings).toHaveCount(0);
    expect(patched).toBe(0);

    // Chương sau AI gặp lại cùng thuật ngữ / cặp: mục đã xoá không quay lại, mục đã sửa giữ bản người dùng.
    await apiReadyChapter(page, "2", { learned }, seriesId);
    await page.goto(`/s/${seriesId}?tab=glossary`);
    const again = page.getByRole("dialog", { name: "Glossary của series" });
    await expect(again.getByRole("row").filter({ hasText: "Min-jun" })).toBeVisible();
    await expect(again.getByRole("row").filter({ hasText: "검성" })).toHaveCount(0);
    await expect(again.getByTitle(AI_TITLE)).toHaveCount(0);
    expect((await getSeries(page, seriesId)).pronoun_rules).toHaveLength(1);
  } finally {
    const res = await page.request.delete(`/api/series/${seriesId}`, { headers });
    expect.soft(res.status()).toBe(204);
  }
});

test("saving settings opened before AI added a pair and filled the style keeps both", async ({ page }) => {
  await login(page);
  const seriesId = await apiSeries(page, {
    title: "Lưu form khi AI ghi e2e",
    pronoun_rules: [{ speaker: "Minjun", listener: "Seoyeon", address: "anh/em", note: "" }],
  });
  try {
    // Chương đang ingest → detail series poll trong lúc form mở, prop `series` của form đổi khi AI ghi.
    const chapterId = await apiCommitChapter(page, "1", seriesId);
    await page.goto(`/s/${seriesId}?tab=settings`);
    const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
    const pronouns = fold(page, "Xưng hô");
    const style = fold(page, "Giọng văn");
    await expect(style.locator("summary")).toContainText("Chưa đặt");
    await pronouns.locator("summary").click();
    await expect(pronouns.locator("tbody tr")).toHaveCount(1);

    // Form đang mở: AI thêm cặp Seoyeon → Minjun và điền Giọng văn; chờ trang poll được bản đã ghi.
    const polled = page.waitForResponse(
      async (r) =>
        r.request().method() === "GET" &&
        r.ok() &&
        r.url().endsWith(`/api/series/${seriesId}`) &&
        ((await r.json()) as SeriesView).style_origin === "ai",
      { timeout: 20_000 },
    );
    await runUntilReady(page, chapterId, {
      learned: { pronoun_pairs: [{ speaker: "Seoyeon", listener: "Minjun", address: "em/anh" }], style_note: STYLE },
    });
    const written = (await (await polled).json()) as SeriesView;
    expect(written.pronoun_rules).toHaveLength(2);
    expect([written.style_prompt, written.style_origin]).toEqual([STYLE, "ai"]);

    // Người dùng sửa hàng xưng hô đang thấy + đổi Kính ngữ rồi Lưu.
    await pronouns.locator("tbody tr").first().getByLabel("Xưng / gọi").fill("tớ/cậu");
    await fold(page, "Kính ngữ").locator("summary").click();
    await settings.getByLabel(/^Kính ngữ/).selectOption("keep");
    await settings.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(settings).toHaveCount(0);

    const saved = await getSeries(page, seriesId);
    expect(saved.honorific_policy).toBe("keep");
    expect([saved.style_prompt, saved.style_origin]).toEqual([STYLE, "ai"]);
    expect(saved.pronoun_rules).toMatchObject([
      { speaker: "Minjun", listener: "Seoyeon", address: "tớ/cậu", origin: "user" },
      { speaker: "Seoyeon", listener: "Minjun", address: "em/anh", origin: "ai" },
    ]);

    // Mở lại: cặp AI và Giọng văn AI có chip; sửa hàng AI thì chip mất ngay trên form.
    await page.getByRole("main").getByRole("link", { name: "Cài đặt dịch" }).click();
    await expect(style.locator("summary").getByTitle(AI_TITLE)).toBeVisible();
    await pronouns.locator("summary").click();
    const aiRow = pronouns.locator("tbody tr").nth(1);
    await expect(pronouns.locator("tbody tr").first().getByTitle(AI_TITLE)).toHaveCount(0);
    await expect(aiRow.getByTitle(AI_TITLE)).toBeVisible();
    await aiRow.getByLabel("Ghi chú").fill("thân thiết");
    await expect(aiRow.getByTitle(AI_TITLE)).toHaveCount(0);
  } finally {
    const res = await page.request.delete(`/api/series/${seriesId}`, { headers });
    expect.soft(res.status()).toBe(204);
  }
});
