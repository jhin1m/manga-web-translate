/**
 * Trình duyệt tiếng Anh đi trọn luồng chính: tạo series → thả ảnh ở màn series → dịch (worker giả) → panel Script và
 * panel khối của editor → xuất và tải. Ở mỗi màn, `<html lang>` là `en` và chữ hiện trên trang không còn ký tự có dấu
 * tiếng Việt, trừ dữ liệu người dùng (tên series / chương do spec khác tạo, bản dịch của worker giả) và tên bản địa
 * "Tiếng Việt" của ô chọn ngôn ngữ. Đổi ngôn ngữ ở Cài đặt rồi tải lại đã có ở `settings-language.spec.ts`.
 */
import { expect, type Page, test } from "@playwright/test";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";
import { login, state } from "./helpers.ts";

test.use({ locale: "en-US" });

/** Ký tự có dấu tiếng Việt (cùng bảng với guard unit test của web). */
const VIETNAMESE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]|[\u0300\u0301\u0303\u0306\u0309\u031b\u0323]/iu;

/** Bản dịch cố định của worker giả và tên bản địa của tiếng Việt trong ô chọn ngôn ngữ: dữ liệu, không phải chữ UI. */
const DATA_TEXT = ["Xin chào", "Tiếng Việt"];

type SeriesList = { series: { title: string; latest_chapter: { title: string | null } | null }[] };

/** Tên series và tên chương mới nhất của mọi series (spec khác có thể đặt tên tiếng Việt). */
async function userTexts(page: Page) {
  const body = (await (await page.request.get("/api/series")).json()) as SeriesList;
  return body.series.flatMap((s) => [s.title, s.latest_chapter?.title ?? ""]).filter((x) => x.length > 0);
}

/** Màn đang mở là tiếng Anh: `<html lang="en">` và không dòng chữ nào có dấu tiếng Việt ngoài dữ liệu. */
async function expectEnglishScreen(page: Page, screen: string, data: readonly string[] = []) {
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // Dài trước để tên chứa tên khác vẫn bị bỏ trọn.
  const skip = [...DATA_TEXT, ...data].sort((a, b) => b.length - a.length);
  const text = await page.evaluate(() => document.body.innerText);
  const offending = text
    .split("\n")
    .map((line) => skip.reduce((acc, s) => acc.split(s).join(""), line))
    .filter((line) => VIETNAMESE.test(line));
  expect(offending, `Vietnamese text on ${screen}`).toEqual([]);
}

test("an English browser goes from a new series to a translated, edited and exported chapter without Vietnamese UI text", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const title = `English smoke ${Date.now()}`;

  await login(page);
  await expectEnglishScreen(page, "home", await userTexts(page));

  // Tạo series ở home: trình duyệt tiếng Anh nên đích mặc định là English.
  await page.getByRole("button", { name: "+ Series" }).click();
  const form = page.getByRole("dialog", { name: "New series" });
  await expect(form.getByLabel("To", { exact: true })).toHaveValue("en");
  await expectEnglishScreen(page, "new series dialog", await userTexts(page));
  await form.getByLabel("Series name").fill(title);
  await form.getByRole("button", { name: "Create series" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expectEnglishScreen(page, "series page");

  // Thả 2 ảnh lẻ ở màn series → 1 chương nháp, mở thẳng màn chương.
  await page
    .getByRole("region", { name: "Add the next chapter" })
    .locator('input[type="file"]:not([webkitdirectory])')
    .setInputFiles(["1.png", "2.png"].map((name) => ({ name, mimeType: "image/png", buffer: PNG_1PX })));
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const chip = page.getByRole("status", { name: "Chapter status" });
  const translate = page.getByRole("button", { name: "Translate chapter", exact: true });
  await expect(translate).toBeEnabled({ timeout: 30_000 });
  await expect(chip).toHaveText("Draft");
  await expectEnglishScreen(page, "draft chapter", [title]);

  // Worker giả nhận mọi loại job (cắt trang, xoá chữ + OCR, dịch, xuất) cho tới khi spec xong.
  let done = false;
  const worker = runFakeWorker(state.token, () => done, 100_000);
  try {
    await translate.click();
    const thumbs = page.getByRole("complementary", { name: "Pages", exact: true });
    await expect(thumbs.getByRole("button", { name: /^Page \d+ · Done$/ })).toHaveCount(2, { timeout: 45_000 });
    await expect(chip).toHaveText(/^In review/);
    await expect(page.getByRole("status", { name: "Chapter lock" })).toContainText("You hold the chapter lock");
    await expectEnglishScreen(page, "translated chapter", [title]);

    // Editor: panel Script, tab Translation (bảng cả chương) → chọn khối → panel khối.
    const rail = page.getByRole("navigation", { name: "Tools" });
    await rail.getByRole("button", { name: /^Script/ }).click();
    const script = page.getByRole("complementary", { name: "Script", exact: true });
    await script.getByRole("tab", { name: /^Translation/ }).click();
    const rows = script.locator(".cw-tbody [data-row]");
    await expect(rows).toHaveCount(2);
    await expectEnglishScreen(page, "Script panel", [title]);
    await rows.first().locator(".cw-src").click();
    await expect(rows.first()).toHaveClass(/\bon\b/);
    await rail.getByRole("button", { name: /^Select/ }).click();
    await expect(page.getByRole("complementary", { name: "Select & edit", exact: true })).toBeVisible();
    await expectEnglishScreen(page, "block panel", [title]);

    // Công cụ xoá chữ bằng bút (phím B): thanh phụ trên canvas.
    await rail.getByRole("button", { name: /\(B\)$/ }).click();
    await expect(page.getByRole("toolbar", { name: "Clean options", exact: true })).toBeVisible();
    await expectEnglishScreen(page, "clean toolbar", [title]);

    // Xuất: menu dưới nút Xuất → tải chương → xong có link Download dự phòng, link trả 302 tới file.
    await page.locator("header.cw-top").getByRole("button", { name: "Export", exact: true }).click();
    const exportMenu = page.getByRole("dialog", { name: "Export chapter" });
    await expect(exportMenu).toBeVisible();
    await expectEnglishScreen(page, "export menu", [title]);
    await exportMenu.getByRole("button", { name: "Download chapter (.zip)", exact: true }).click();
    const link = exportMenu.getByRole("link", { name: "Download", exact: true });
    await expect(link).toBeVisible({ timeout: 45_000 });
    const href = (await link.getAttribute("href")) ?? "";
    expect((await page.request.get(href, { maxRedirects: 0 })).status()).toBe(302);
    await expectEnglishScreen(page, "export finished", [title]);
  } finally {
    done = true;
    await worker;
  }

  await page.goto("/settings");
  await expect(page.getByLabel("Interface language")).toHaveValue("en");
  await expectEnglishScreen(page, "settings", await userTexts(page));

  expect(pageErrors).toEqual([]);
});
