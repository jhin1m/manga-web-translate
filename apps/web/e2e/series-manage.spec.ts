/**
 * Quản lý series / chương: xoá series từ hàng series ở home và xoá chương từ hàng chương (xác nhận tại chỗ; Huỷ không
 * xoá), chuyển tab Chương / Glossary / Cài đặt giữ nguyên đầu trang series; chọn ngôn ngữ gốc khi tạo series và
 * sửa ngôn ngữ đích / định dạng truyện trong Cài đặt. Tên series dài cắt "…" (title đủ tên), không đè cột trạng thái
 * ở home, không tràn ở trang series và thanh trên màn chương.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { apiReadyChapter, login, state } from "./helpers.ts";

test("delete a whole series from its home row, after an explicit confirm", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/series`, {
    headers: { origin: WEB_URL },
    data: { title: "Series xoá e2e" },
  });
  expect(created.status()).toBe(201);
  const s = (await created.json()) as { id: string };
  const chapter = await page.request.post(`/api/chapters`, {
    headers: { origin: WEB_URL },
    data: {
      series_id: s.id,
      number: "1",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(chapter.status()).toBe(201);

  await page.goto("/");
  const row = page.locator(`.row-item[data-series="${s.id}"]`);
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Xoá series Series xoá e2e" }).click();
  await expect(row.getByText("cùng 1 chương")).toBeVisible();
  await row.getByRole("button", { name: "Huỷ" }).click();
  await expect(row.getByRole("link", { name: /^Series xoá e2e/ })).toBeVisible();

  await row.getByRole("button", { name: "Xoá series Series xoá e2e" }).click();
  await row.getByRole("button", { name: "Xoá series", exact: true }).click();
  await expect(row).toHaveCount(0);
  const gone = await page.request.get(`/api/series/${s.id}`);
  expect(gone.status()).toBe(404);
});

test("delete a chapter from the series page, after an explicit confirm", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/chapters`, {
    headers: { origin: WEB_URL },
    data: {
      series_id: state.seriesId,
      number: "9301",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  const { chapter } = (await created.json()) as { chapter: { id: string } };

  await page.goto(`/s/${state.seriesId}`);
  const row = page.locator(`.row-item[data-chapter="${chapter.id}"]`);
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Xoá chương 9301" }).click();
  await row.getByRole("button", { name: "Huỷ" }).click();
  await expect(row.getByRole("link", { name: "Mở chương 9301" })).toBeVisible();

  await row.getByRole("button", { name: "Xoá chương 9301" }).click();
  await row.getByRole("button", { name: "Xoá chương", exact: true }).click();
  await expect(row).toHaveCount(0);
  const gone = await page.request.get(`/api/chapters/${chapter.id}`);
  expect(gone.status()).toBe(404);
});

test("series modals keep the series header behind them and close back to the series page", async ({ page }) => {
  await login(page);
  await page.goto(`/s/${state.seriesId}`);
  await page.getByRole("main").getByRole("link", { name: "Cài đặt dịch" }).click();
  const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
  await expect(page).toHaveURL(/\?tab=settings/);
  await expect(settings).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Series e2e" })).toBeVisible();
  await expect(settings.getByLabel("Tên series", { exact: true })).toHaveValue("Series e2e");

  await settings.getByRole("button", { name: "Đóng" }).click();
  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(`${WEB_URL}/s/${state.seriesId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Series e2e" })).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("link", { name: /^Glossary/ })
    .click();
  await expect(page).toHaveURL(/\?tab=glossary/);
  const glossary = page.getByRole("dialog", { name: "Glossary của series" });
  await expect(glossary.getByRole("form", { name: "Thêm từ vào glossary" })).toBeVisible();
  await glossary.getByRole("button", { name: "Đóng" }).click();
  await expect(glossary).toHaveCount(0);
  await expect(page).toHaveURL(`${WEB_URL}/s/${state.seriesId}`);
});

test("new series picks the comic kind (source language); settings edit target language, page format and ignored text", async ({
  page,
}) => {
  await login(page);
  await page.goto("/");
  await page.getByRole("button", { name: "+ Series mới" }).click();
  const form = page.getByRole("form", { name: "Tạo series mới" });
  await form.getByLabel("Tên series").fill("Manga Nhật e2e");
  await form.getByText("Nhật · từng trang, dịch thẳng").click();
  await expect(form.getByRole("radio", { name: /^Manga Nhật/ })).toBeChecked();
  await page.getByRole("button", { name: "Tạo series" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Manga Nhật e2e" })).toBeVisible();
  await expect(page.getByText(/Nhật → Việt/)).toBeVisible();

  // Cài đặt dịch là modal trên màn series: form nằm trong dialog, save giữ modal mở.
  await page.getByRole("main").getByRole("link", { name: "Cài đặt dịch" }).click();
  const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
  // ja → server tự chọn "Từng trang".
  await expect(settings.getByLabel("Định dạng truyện")).toHaveValue("pages");
  await settings.getByLabel("Ngôn ngữ đích").selectOption("en");
  await settings.getByLabel("Định dạng truyện").selectOption("strip");
  await settings.getByRole("button", { name: "Lưu cài đặt" }).click();
  // Lưu đổi settings_rev → form dựng lại theo giá trị mới từ server.
  await expect(page.getByText(/Nhật → Anh/)).toBeVisible();
  await expect(settings.getByLabel("Định dạng truyện")).toHaveValue("strip");

  // Chữ bỏ qua (watermark): dòng quá ngắn báo lỗi tại dòng, chặn lưu; sửa xong lưu được, mục trùng gộp lại.
  const ignore = settings.getByLabel("Chữ bỏ qua (watermark)");
  await ignore.fill("discord.gg/nhom\nab");
  await expect(settings.getByText("Dòng 2: mỗi mục 3–100 ký tự (không tính http:// và dấu cách).")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Lưu cài đặt" })).toBeDisabled();
  await ignore.fill("discord.gg/nhom\nDISCORD.GG/NHOM\nNhóm Mèo");
  await settings.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect(settings.getByRole("status").filter({ hasText: "Đã lưu" })).toBeVisible();
  await expect(ignore).toHaveValue("discord.gg/nhom\nNhóm Mèo");
  await settings.getByRole("button", { name: "Đóng" }).click();
  await expect(settings).toHaveCount(0);

  const url = new URL(page.url());
  const seriesId = url.pathname.split("/").at(-1) as string;
  const s = (await (await page.request.get(`/api/series/${seriesId}`)).json()) as {
    source_lang: string;
    target_lang: string;
    page_format: string;
    ignore_text: string[];
  };
  expect([s.source_lang, s.target_lang, s.page_format]).toEqual(["ja", "en", "strip"]);
  expect(s.ignore_text).toEqual(["discord.gg/nhom", "Nhóm Mèo"]);
});

test("ignored text hides matching boxes of translated chapters after a preview, and undo brings them back", async ({
  page,
}) => {
  await login(page);
  const headers = { origin: WEB_URL };
  const first = await apiReadyChapter(page, "4101");
  const second = await apiReadyChapter(page, "4102");
  const pageIdOf = async (chapterId: string) => {
    const p = (await (await page.request.get(`/api/chapters/${chapterId}/progress`)).json()) as {
      pages: { id: string }[];
    };
    return p.pages[0]?.id as string;
  };
  const hiddenBoxes = async (chapterId: string) => {
    const r = (await (await page.request.get(`/api/pages/${await pageIdOf(chapterId)}`)).json()) as {
      state: { text_boxes: { hidden: boolean }[] };
    };
    return r.state.text_boxes.filter((b) => b.hidden).length;
  };
  const setIgnore = (ignore_text: string[]) =>
    page.request.patch(`/api/series/${state.seriesId}`, { headers, data: { ignore_text } });
  // Worker giả chỉ trả vùng (không box): người dùng đặt chữ lên vùng t0 như khi sửa tay.
  const placeBox = async (chapterId: string) => {
    const pageId = await pageIdOf(chapterId);
    const cur = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as {
      version: number;
      state: Record<string, unknown>;
    };
    const box = {
      id: "wm",
      region_id: "t0",
      x: 40,
      y: 40,
      w: 120,
      h: 50,
      rotation: 0,
      text: "Xin chào",
      lines: ["Xin chào"],
      font_family: "PatrickHand-Regular",
      font_size: 22,
      line_height: 1.15,
      pad: 4,
      letter_spacing: 0,
      align: "center",
      fill: "#000000",
      stroke: null,
      auto_fit: false,
      hidden: false,
    };
    expect((await page.request.post(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
    const put = await page.request.put(`/api/pages/${pageId}/state`, {
      headers: { ...headers, "if-match": `"${cur.version}"` },
      data: { state: { ...cur.state, text_boxes: [box] } },
    });
    expect(put.ok()).toBe(true);
    expect((await page.request.delete(`/api/chapters/${chapterId}/lock`, { headers })).ok()).toBe(true);
  };
  await placeBox(first);
  await placeBox(second);
  expect(await hiddenBoxes(first)).toBe(0);

  try {
    // Fake worker OCR "안녕하세요": mục có dấu cách chen giữa vẫn khớp (so khớp bỏ dấu cách).
    expect((await setIgnore(["안녕 하세요"])).status()).toBe(200);
    await page.goto(`/s/${state.seriesId}?tab=settings`);
    const section = page.getByRole("region", { name: "Ẩn chữ khớp trong chương đã dịch" });
    await section.getByRole("button", { name: "Ẩn chữ khớp trong chương đã dịch…" }).click();
    await expect(section.getByText(/^Sẽ ẩn \d+ box ở \d+ chương/)).toBeVisible();
    await expect(section.getByText("Chương 4101")).toBeVisible();
    await expect(section.getByText("Chương 4102")).toBeVisible();
    expect(await hiddenBoxes(first)).toBe(0);

    await section.getByRole("button", { name: /^Ẩn \d+ box$/ }).click();
    const done = section.getByRole("status");
    await expect(done).toContainText(/Đã ẩn \d+ box ở \d+ chương/);
    expect(await hiddenBoxes(first)).toBeGreaterThan(0);
    expect(await hiddenBoxes(second)).toBeGreaterThan(0);

    await done.getByRole("button", { name: "Hoàn tác" }).click();
    await expect(done).toContainText(/Đã hoàn tác \d+ trang ở \d+ chương/);
    expect(await hiddenBoxes(first)).toBe(0);
    expect(await hiddenBoxes(second)).toBe(0);
  } finally {
    await setIgnore([]);
  }
});

test("a very long series name is truncated with a full-name title and never overlaps the status column", async ({
  page,
}) => {
  await login(page);
  const title = `Series_${"DaiKhongDauCach".repeat(4)} ${"tên rất dài có dấu cách ".repeat(3)}`.slice(0, 120).trim();
  const created = await page.request.post(`/api/series`, {
    headers: { origin: WEB_URL },
    data: { title },
  });
  expect(created.status()).toBe(201);
  const s = (await created.json()) as { id: string };
  const chapter = await page.request.post(`/api/chapters`, {
    headers: { origin: WEB_URL },
    data: {
      series_id: s.id,
      number: "1",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(chapter.status()).toBe(201);
  const chapterId = ((await chapter.json()) as { chapter: { id: string } }).chapter.id;

  for (const width of [1568, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const row = page.locator(`.row-item[data-series="${s.id}"]`);
    const name = row.locator(".row-name");
    await expect(name).toHaveAttribute("title", title);
    const status = row.locator(".row-open .grow");
    await expect(status).toContainText("Ch.1");
    const n = await name.boundingBox();
    const st = await status.boundingBox();
    if (!n || !st) throw new Error("row not laid out");
    // Cùng hàng → tên kết thúc trước cột trạng thái; xuống hàng (màn hẹp) → không chồng theo chiều dọc.
    const sameLine = n.y < st.y + st.height && st.y < n.y + n.height;
    if (sameLine) expect(n.x + n.width).toBeLessThanOrEqual(st.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  // Trang series + thanh trên màn chương: không tràn ngang.
  await page.setViewportSize({ width: 1568, height: 800 });
  await page.goto(`/s/${s.id}`);
  const heading = page.getByRole("heading", { name: title });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveAttribute("title", title);
  // Cắt "…" trên 1 dòng: chữ dài hơn khung, không xuống dòng.
  expect(await heading.evaluate((h) => h.scrollWidth > h.clientWidth && getComputedStyle(h).textOverflow)).toBe(
    "ellipsis",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`/s/${s.id}/c/${chapterId}`);
  const back = page.locator(".cw-back");
  await expect(back).toHaveAttribute("title", title);
  expect((await page.locator(".cw-back-name").boundingBox())?.width ?? 999).toBeLessThanOrEqual(240);

  // Dọn: series này có chương mới nhất → spec sau thả file sẽ đoán nhầm vào nó.
  await page.goto("/");
  const del = await page.request.delete(`/api/series/${s.id}`, { headers: { origin: WEB_URL } });
  expect(del.ok()).toBe(true);
});
