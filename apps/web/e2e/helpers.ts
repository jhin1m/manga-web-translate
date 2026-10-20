/** Dùng chung cho các spec: state seed (global-setup) + đăng nhập (dev auto-login hoặc form) rồi chờ home `/`. */
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { type E2EState, STATE_FILE, WEB_URL } from "./env.ts";
import { type FakeWorkerOptions, PNG_1PX, runFakeWorker } from "./fake-worker.ts";

export const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;

async function expectHome(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();
}

/** API e2e bật dev auto-login cho owner seed → mở `/` là vào thẳng home. */
export async function login(page: Page) {
  await page.goto("/");
  await expectHome(page);
}

/** Đăng nhập bằng form `/login` (giữ 1 đường kiểm form không bị auto-login che). */
export async function loginWithForm(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Mật khẩu").fill(state.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expectHome(page);
}

/** Chương 1 ảnh nguồn tạo + upload + commit qua API rồi chạy worker giả tới khi mọi page "ready" → id chương. */
export async function apiReadyChapter(page: Page, number: string, opts: FakeWorkerOptions = {}) {
  const ws = state.workspaceId;
  const headers = { origin: WEB_URL };
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

  let ready = false;
  let stop = false;
  const worker = runFakeWorker(state.token, () => stop, 30_000, opts);
  const deadline = Date.now() + 30_000;
  while (!ready && Date.now() < deadline) {
    const p = (await (await page.request.get(`/api/w/${ws}/chapters/${chapter.id}/progress`)).json()) as {
      pages: { status: string }[];
    };
    ready = p.pages.length > 0 && p.pages.every((x) => x.status === "ready");
    if (!ready) await page.waitForTimeout(300);
  }
  stop = true;
  await worker;
  if (!ready) throw new Error("chapter not ready");
  return chapter.id;
}
