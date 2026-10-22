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

/** Chương xong bước 1 (`prepared`) → bấm bước 2 "Dịch" qua API để worker giả dịch tiếp. */
export async function translateIfPrepared(page: Page, chapterId: string, status: string) {
  if (status !== "prepared") return;
  const r = await page.request.post(`/api/w/${state.workspaceId}/chapters/${chapterId}/translate-prepared`, {
    headers: { origin: WEB_URL },
  });
  expect(r.status()).toBe(202);
}

/** Chương 1 ảnh nguồn tạo + upload + bước 1 (commit) qua API rồi chạy worker giả (+ bước 2) tới khi mọi page "ready". */
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
      chapter: { status: string };
      pages: { status: string }[];
    };
    await translateIfPrepared(page, chapter.id, p.chapter.status);
    ready = p.pages.length > 0 && p.pages.every((x) => x.status === "ready");
    if (!ready) await page.waitForTimeout(300);
  }
  stop = true;
  await worker;
  if (!ready) throw new Error("chapter not ready");
  return chapter.id;
}

/** Nút rail công cụ màn chương → tiêu đề panel nó mở (tên của `complementary`). */
const PANELS = {
  select: ["Chọn (V)", "Chọn & sửa"],
  text: ["Chữ (T)", "Thêm chữ"],
  table: ["Bản dịch cả chương", "Bản dịch cả chương"],
  find: ["Tìm / Thay · Glossary (Ctrl+F)", "Tìm / Thay · Glossary"],
} as const;

/** Nút trên rail công cụ màn chương. */
export const railButton = (page: Page, panel: keyof typeof PANELS) =>
  page.getByRole("navigation", { name: "Công cụ" }).getByRole("button", { name: PANELS[panel][0], exact: true });

/** Mở panel qua rail công cụ (đang mở thì giữ — bấm lại sẽ thu) → vùng panel. */
export async function openPanel(page: Page, panel: keyof typeof PANELS) {
  const btn = railButton(page, panel);
  await expect(btn).toBeEnabled({ timeout: 15_000 });
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  return page.getByRole("complementary", { name: PANELS[panel][1], exact: true });
}

/** Panel Tìm, đoạn "Tìm / Thay" hoặc "Áp glossary" → vùng của đoạn đó. */
export async function openFind(page: Page, part: "Tìm / Thay" | "Glossary") {
  const panel = await openPanel(page, "find");
  const seg = panel.getByRole("button", { name: part, exact: true });
  await seg.click();
  await expect(seg).toHaveAttribute("aria-pressed", "true");
  return panel.getByRole("group", { name: part === "Glossary" ? "Áp glossary" : "Tìm / Thay", exact: true });
}

/** Cột thumbnail trang của màn chương. */
export const pageThumbs = (page: Page) => page.getByRole("complementary", { name: "Danh sách trang" });

/** Thumbnail trang `n` (tên truy cập "Trang n · <trạng thái>"). */
export const pageThumb = (page: Page, n: number) =>
  pageThumbs(page).getByRole("button", { name: new RegExp(`^Trang ${n} · `) });
