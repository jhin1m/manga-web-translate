/**
 * Gợi ý AI ở màn series: dịch xong chương → badge trên nút Glossary / icon Cài đặt dịch; Nhận / Bỏ thuật ngữ trong
 * modal Glossary; Nhận xưng hô chỉ thêm hàng vào bảng cho tới khi bấm Lưu; reload không còn badge khi đã xử lý hết.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { apiReadyChapter, login } from "./helpers.ts";

const headers = { origin: WEB_URL };
const learned = {
  new_terms: [
    { source: "민준", target: "Minjun", kind: "person" as const },
    { source: "검성", target: "Kiếm Thánh", kind: "term" as const },
  ],
  pronoun_pairs: [{ speaker: "Minjun", listener: "Seoyeon", address: "anh/em" }],
};

test("AI suggestions: badges, accept / dismiss terms, accept pronoun then save", async ({ page }) => {
  await login(page);
  // Series riêng + 1 chương dịch xong bằng worker giả có trả gợi ý; xoá khi xong để không lọt vào spec khác
  // (thả file ở home chọn series của chương mới nhất).
  const created = await page.request.post("/api/series", { headers, data: { title: "Gợi ý AI e2e" } });
  expect(created.status()).toBe(201);
  const seriesId = ((await created.json()) as { id: string }).id;
  try {
    await apiReadyChapter(page, "3", { learned }, seriesId);
    const main = page.getByRole("main");

    // Badge: 2 thuật ngữ trên Glossary, 1 cặp xưng hô trên Cài đặt dịch; tên link Glossary vẫn bắt đầu bằng "Glossary".
    await page.goto(`/s/${seriesId}`);
    await expect(main.getByRole("link", { name: /^Glossary/ }).getByTestId("glossary-hint-badge")).toHaveText("2");
    await expect(main.getByRole("link", { name: "Cài đặt dịch" }).getByTestId("settings-hint-badge")).toHaveText("1");

    // Glossary: Nhận 민준 → vào bảng glossary, badge còn 1; Bỏ 검성 → danh sách gợi ý biến mất.
    await main.getByRole("link", { name: /^Glossary/ }).click();
    const glossary = page.getByRole("dialog", { name: "Glossary của series" });
    await expect(glossary.getByText("Gợi ý từ AI · 2")).toBeVisible();
    await glossary.getByRole("button", { name: "Nhận 민준" }).click();
    await expect(glossary.getByText("Gợi ý từ AI · 1")).toBeVisible();
    await expect(glossary.getByRole("cell", { name: "Minjun", exact: true })).toBeVisible();
    // Focus sang hàng còn lại, không rơi về body.
    await expect(glossary.getByRole("button", { name: "Nhận 검성" })).toBeFocused();
    await glossary.getByRole("button", { name: "Bỏ 검성" }).click();
    await expect(glossary.getByText(/Gợi ý từ AI/)).toHaveCount(0);
    // Hết gợi ý: focus ở lại trong modal (ô nhập của glossary).
    await expect(glossary.locator(":focus")).toHaveCount(1);
    await glossary.getByRole("button", { name: "Đóng" }).click();
    await expect(main.getByTestId("glossary-hint-badge")).toHaveCount(0);
    await expect(main.getByTestId("settings-hint-badge")).toHaveText("1");

    // Cài đặt dịch: summary có "1 gợi ý"; Nhận chỉ thêm hàng vào bảng; Lưu rồi mở lại vẫn còn quy tắc, hết gợi ý.
    await main.getByRole("link", { name: "Cài đặt dịch" }).click();
    const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
    const fold = settings.locator("details").filter({ hasText: "Xưng hô" });
    await expect(fold.getByText("Chưa có · 1 gợi ý")).toBeVisible();
    await fold.locator("summary").click();
    await fold.getByRole("button", { name: "Nhận Minjun → Seoyeon" }).click();
    await expect(fold.getByLabel("Người nói")).toHaveValue("Minjun");
    await expect(fold.getByLabel("Xưng / gọi")).toHaveValue("anh/em");
    await expect(fold.getByText("Đã thêm vào bảng — bấm Lưu để áp dụng.")).toBeVisible();
    await expect(fold.getByLabel("Xưng / gọi")).toBeFocused();
    await expect(fold.getByRole("button", { name: /^Nhận / })).toHaveCount(0);
    // Xoá hàng vừa Nhận: lời nhắc tắt, gợi ý quay lại; Nhận lần nữa để đi tiếp.
    await fold.getByRole("button", { name: "Xoá", exact: true }).click();
    await expect(fold.getByText("Đã thêm vào bảng — bấm Lưu để áp dụng.")).toHaveCount(0);
    await fold.getByRole("button", { name: "Nhận Minjun → Seoyeon" }).click();
    await expect(fold.getByText("Đã thêm vào bảng — bấm Lưu để áp dụng.")).toBeVisible();
    await settings.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(main.getByTestId("settings-hint-badge")).toHaveCount(0);

    await main.getByRole("link", { name: "Cài đặt dịch" }).click();
    const again = page.getByRole("dialog", { name: "Cài đặt dịch" }).locator("details").filter({ hasText: "Xưng hô" });
    await expect(again.getByText("1 quy tắc")).toBeVisible();
    await again.locator("summary").click();
    await expect(again.getByLabel("Người nói")).toHaveValue("Minjun");
    await expect(again.getByText(/Gợi ý từ AI/)).toHaveCount(0);

    // Reload: không còn badge nào.
    await page.goto(`/s/${seriesId}`);
    await expect(main.getByRole("link", { name: /^Glossary/ })).toBeVisible();
    await expect(main.getByTestId("glossary-hint-badge")).toHaveCount(0);
    await expect(main.getByTestId("settings-hint-badge")).toHaveCount(0);
  } finally {
    const res = await page.request.delete(`/api/series/${seriesId}`, { headers });
    expect.soft(res.status()).toBe(204);
  }
});
