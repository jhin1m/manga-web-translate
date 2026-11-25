/**
 * AI tự ghi trí nhớ series khi dịch: thuật ngữ vào glossary, cặp xưng hô mới, Giọng văn (khi còn trống) — có chip
 * "AI", không còn gợi ý Nhận / Bỏ. Sửa mục AI thì chip mất; mục AI đã xoá không quay lại. Cài đặt dịch tự lưu từng
 * trường vừa đổi: mục AI ghi trong lúc form mở hiện vào trường người dùng không đang sửa, và không bị lượt lưu đè.
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

/**
 * Nhóm "Hướng dẫn cho AI" của Cài đặt dịch (gập sẵn mỗi lần mở modal — `open()` bấm tiêu đề để mở): ô Giọng văn (+ chip
 * ở nhãn), bảng xưng hô.
 */
const aiGroup = (page: Page) => {
  const group = page.getByRole("dialog", { name: "Cài đặt dịch" }).getByRole("region", { name: "Hướng dẫn cho AI" });
  const toggle = group.getByRole("button", { name: "Hướng dẫn cho AI" });
  return {
    open: async () => {
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    },
    style: group.getByLabel("Giọng văn", { exact: true }),
    styleTag: group
      .locator(".set-row", { has: page.locator("#s-style") })
      .locator(".set-row-label")
      .getByTitle(AI_TITLE),
    rows: group.locator("tbody tr"),
  };
};

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

    // Cài đặt dịch: cặp xưng hô + Giọng văn có chip; không còn gợi ý. Mở rồi đóng không đổi gì → không gọi PATCH.
    let patched = 0;
    page.on("request", (r) => r.method() === "PATCH" && r.url().includes(`/api/series/${seriesId}`) && patched++);
    await main.getByRole("link", { name: "Cài đặt dịch" }).click();
    const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
    const ai = aiGroup(page);
    await ai.open();
    await expect(ai.style).toHaveValue(STYLE);
    await expect(ai.styleTag).toBeVisible();
    await expect(ai.rows).toHaveCount(1);
    await expect(ai.rows.first().getByTitle(AI_TITLE)).toBeVisible();
    await expect(settings.getByText(/Gợi ý từ AI/)).toHaveCount(0);
    await expect(settings.getByRole("button", { name: /^(Nhận|Bỏ) / })).toHaveCount(0);
    await settings.getByRole("button", { name: "Đóng" }).click();
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

test("settings left open while AI writes: untouched fields show what AI wrote, the row being edited saves without dropping the new pair", async ({
  page,
}) => {
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
    const ai = aiGroup(page);
    await ai.open();
    await expect(ai.style).toHaveValue("");
    await expect(ai.rows).toHaveCount(1);
    // Người dùng đang sửa hàng xưng hô (con trỏ còn trong hàng) thì AI ghi.
    await ai.rows.first().getByLabel("Xưng / gọi").fill("tớ/cậu");

    // AI thêm cặp Seoyeon → Minjun và điền Giọng văn; chờ trang poll được bản đã ghi.
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

    // Giọng văn (không ai sửa) hiện bản AI kèm chip; bảng xưng hô đang sửa giữ nguyên.
    await expect(ai.style).toHaveValue(STYLE);
    await expect(ai.styleTag).toBeVisible();
    await expect(ai.rows).toHaveCount(1);
    await expect(ai.rows.first().getByLabel("Xưng / gọi")).toHaveValue("tớ/cậu");

    // Rời hàng → lưu hàng đã sửa; cặp AI chưa thấy được server giữ rồi hiện ra. Kính ngữ lưu ngay khi đổi.
    await settings.getByLabel("Kính ngữ", { exact: true }).focus();
    await expect(ai.rows).toHaveCount(2);
    await settings.getByLabel("Kính ngữ", { exact: true }).selectOption("keep");
    await expect.poll(async () => (await getSeries(page, seriesId)).honorific_policy).toBe("keep");

    const saved = await getSeries(page, seriesId);
    expect([saved.style_prompt, saved.style_origin]).toEqual([STYLE, "ai"]);
    expect(saved.pronoun_rules).toMatchObject([
      { speaker: "Minjun", listener: "Seoyeon", address: "tớ/cậu", origin: "user" },
      { speaker: "Seoyeon", listener: "Minjun", address: "em/anh", origin: "ai" },
    ]);

    // Cặp AI có chip, cặp người dùng sửa thì không; sửa hàng AI thì chip mất ngay trên form.
    const aiRow = ai.rows.nth(1);
    await expect(ai.rows.first().getByTitle(AI_TITLE)).toHaveCount(0);
    await expect(aiRow.getByTitle(AI_TITLE)).toBeVisible();
    await aiRow.getByLabel("Ghi chú").fill("thân thiết");
    await expect(aiRow.getByTitle(AI_TITLE)).toHaveCount(0);
  } finally {
    const res = await page.request.delete(`/api/series/${seriesId}`, { headers });
    expect.soft(res.status()).toBe(204);
  }
});
