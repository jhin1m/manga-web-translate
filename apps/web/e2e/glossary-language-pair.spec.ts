/**
 * Glossary chung theo cặp nguồn→đích: bộ chọn cặp giữ trong URL, mỗi cặp một bảng riêng; series chỉ kế thừa entry
 * chung đúng cặp của nó, và form Cài đặt cảnh báo khi đổi ngôn ngữ mà series có glossary riêng.
 */
import { expect, type Page, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { login } from "./helpers.ts";

const headers = { origin: WEB_URL };

async function post(page: Page, path: string, data: unknown) {
  const r = await page.request.post(`/api${path}`, { headers, data });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
}

test("shared glossary: each language pair has its own table, the pair stays in the URL", async ({ page }) => {
  await login(page);
  await page.goto(`/glossary`);
  await expect(page.getByLabel("Ngôn ngữ gốc")).toHaveValue("ko");
  await expect(page.getByLabel("Ngôn ngữ đích")).toHaveValue("vi");

  await page.getByLabel("Ngôn ngữ đích").selectOption("en");
  await expect(page).toHaveURL(/src=ko&tgt=en/);
  await expect(page.getByText("Áp cho series dịch Hàn → Anh")).toBeVisible();
  await page.getByLabel("Từ gốc mới").fill("대표e2e");
  await page.getByLabel("Bản dịch mới").fill("CEO e2e");
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.getByRole("cell", { name: "CEO e2e" })).toBeVisible();

  await page.getByLabel("Ngôn ngữ đích").selectOption("vi");
  await expect(page).toHaveURL(/src=ko&tgt=vi/);
  await expect(page.getByText("Áp cho series dịch Hàn → Việt")).toBeVisible();
  await expect(page.getByRole("cell", { name: "CEO e2e" })).toHaveCount(0);

  await page.goto(`/glossary?src=ko&tgt=en`);
  await expect(page.getByLabel("Ngôn ngữ đích")).toHaveValue("en");
  await expect(page.getByRole("cell", { name: "CEO e2e" })).toBeVisible();
});

test("changing a series language warns about its own glossary and switches the inherited pair", async ({ page }) => {
  await login(page);
  const s = await post(page, "/series", { title: "Glossary cặp e2e" });
  await post(page, `/series/${s.id}/glossary`, { source_term: "검e2e", target_term: "kiếm riêng" });
  await post(page, "/glossary?source_lang=ko&target_lang=vi", { source_term: "회장e2e", target_term: "chủ tịch e2e" });
  await post(page, "/glossary?source_lang=ko&target_lang=en", { source_term: "회장e2e", target_term: "chairman e2e" });

  // Glossary và Cài đặt dịch là modal trên màn series (`?tab=`), mở từ link đầu trang.
  await page.goto(`/s/${s.id}?tab=glossary`);
  const glossary = page.getByRole("dialog", { name: "Glossary của series" });
  await expect(glossary.getByRole("row").filter({ hasText: "chủ tịch e2e" })).toContainText(
    "từ glossary chung (Hàn → Việt)",
  );
  await glossary.getByRole("button", { name: "Đóng" }).click();
  await expect(glossary).toHaveCount(0);

  await page.getByRole("main").getByRole("link", { name: "Cài đặt dịch" }).click();
  const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
  const warning = settings.getByRole("status").filter({ hasText: "Glossary riêng của series" });
  await expect(warning).toHaveCount(0);
  await settings.getByLabel("Ngôn ngữ đích").selectOption("en");
  await expect(warning).toHaveText(
    "Glossary riêng của series có 1 từ viết cho Hàn → Việt — kiểm lại sau khi đổi ngôn ngữ. " +
      "Glossary chung sẽ chuyển sang cặp Hàn → Anh.",
  );
  // Cảnh báo không chặn lưu.
  await settings.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect(page.getByText(/Hàn → Anh · /)).toBeVisible();
  await settings.getByRole("button", { name: "Đóng" }).click();
  await expect(settings).toHaveCount(0);

  // Không tải lại trang: glossary series làm mới theo cặp mới.
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Glossary/ })
    .click();
  await expect(glossary.getByRole("row").filter({ hasText: "chairman e2e" })).toContainText(
    "từ glossary chung (Hàn → Anh)",
  );
  await expect(glossary.getByRole("cell", { name: "chủ tịch e2e" })).toHaveCount(0);
  await expect(glossary.getByRole("cell", { name: "kiếm riêng" })).toBeVisible();
});
