/** Luồng chính: upload ZIP 10 trang (tên xáo trộn) → thứ tự tự nhiên → commit → worker giả → 10 trang "Sẵn sàng". */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { type E2EState, STATE_FILE } from "./env.ts";
import { PNG_1PX, runFakeWorker } from "./fake-worker.ts";

const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;

test("upload a 10-page ZIP and see 10 ready pages", async ({ page }) => {
  const names = ["10.png", "2.png", "1.png", "9.png", "3.png", "8.png", "4.png", "7.png", "5.png", "6.png"];
  const zip = zipSync(
    Object.fromEntries([
      ...names.map((n) => [`chuong-1/${n}`, new Uint8Array(PNG_1PX)]),
      ["__MACOSX/chuong-1/._1.png", new Uint8Array([0])],
    ]),
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Mật khẩu").fill(state.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();

  await page.goto(`/w/${state.workspaceId}/series/${state.seriesId}/upload`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "chuong-1.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await expect(page.getByRole("heading", { name: /^10 trang/ })).toBeVisible();
  const order = await page.locator("table.data tbody tr td.mono").allTextContents();
  expect(order).toEqual(Array.from({ length: 10 }, (_, i) => `chuong-1/${i + 1}.png`));

  await page.getByRole("button", { name: "Upload và xử lý" }).click();
  await expect(page).toHaveURL(/\/chapters\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  let ready = false;
  const worker = runFakeWorker(state.token, () => ready);
  await expect(page.getByText(/10 trang · sẵn sàng 10/)).toBeVisible({ timeout: 30_000 });
  ready = true;
  await worker;
  await expect(page.locator(".status", { hasText: "Sẵn sàng" })).toHaveCount(10);
  await expect(page.locator(".status", { hasText: "Chờ duyệt" })).toBeVisible();
  // Thumbnail là ảnh sạch ký qua FILES_DOMAIN.
  await expect(page.locator("img").first()).toHaveAttribute("src", /localhost:9100\/.*\/clean\//);
});
