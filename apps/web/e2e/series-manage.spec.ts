/**
 * Quản lý series / chương: xoá series từ thẻ series ở home và xoá chương từ thẻ chương (xác nhận tại chỗ; Huỷ không
 * xoá), chuyển tab Chương / Glossary / Cài đặt giữ nguyên đầu trang series; chọn ngôn ngữ gốc khi tạo series và
 * sửa ngôn ngữ đích / định dạng truyện trong Cài đặt (tự lưu từng trường, không có nút Lưu). Tên series dài cắt "…" (title đủ tên), không đè cột trạng thái
 * ở home, không tràn ở trang series và thanh trên màn chương.
 */
import { expect, test } from "@playwright/test";
import { WEB_URL } from "./env.ts";
import { PNG_1PX } from "./fake-worker.ts";
import { apiReadyChapter, login, state } from "./helpers.ts";

const headers = { origin: WEB_URL };

async function apiSeries(page: import("@playwright/test").Page, title: string) {
  const created = await page.request.post(`/api/series`, { headers, data: { title } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test("delete a whole series from its home card, after an explicit confirm", async ({ page }) => {
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
  const row = page.locator(`.card[data-series="${s.id}"]`);
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
  const row = page.locator(`.card[data-chapter="${chapter.id}"]`);
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

test("new series defaults to an English source; settings edit target language, page format and ignored text", async ({
  page,
}) => {
  await login(page);
  await page.goto("/");
  await page.getByRole("button", { name: "+ Series" }).click();
  const form = page.getByRole("dialog", { name: "Tạo series mới" });
  await expect(form.getByLabel("Dịch từ")).toHaveValue("en");
  await expect(form.getByLabel("Sang")).toHaveValue("vi");
  // Esc đóng modal, trả focus về "+ Series".
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Series" })).toBeFocused();
  await page.getByRole("button", { name: "+ Series" }).click();
  await form.getByLabel("Tên series").fill("Manga Nhật e2e");
  await form.getByLabel("Loại truyện").selectOption({ label: "Manga" });
  // Enter ở ô tên = Tạo series.
  await form.getByLabel("Tên series").press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Manga Nhật e2e" })).toBeVisible();
  const head = page.locator(".series-head");
  await expect(head.getByText(/Anh → Việt/)).toBeVisible();

  // Cài đặt dịch là modal trên màn series, tự lưu: ô chọn lưu ngay khi đổi, không có nút Lưu.
  const seriesId = new URL(page.url()).pathname.split("/").at(-1) as string;
  type Saved = { source_lang: string; target_lang: string; page_format: string; ignore_text: string[] };
  const saved = async () => (await (await page.request.get(`/api/series/${seriesId}`)).json()) as Saved;
  const openSettings = () => page.getByRole("main").getByRole("link", { name: "Cài đặt dịch" }).click();
  await openSettings();
  const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
  await expect(settings.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
  // Loại Manga → "Từng trang".
  await expect(settings.getByLabel("Định dạng", { exact: true })).toHaveValue("pages");
  await settings.getByLabel("Sang", { exact: true }).selectOption("id");
  // Lưu xong thì đầu trang phía sau modal đổi theo.
  await expect(head.getByText(/Anh → Indonesia/)).toBeVisible();
  await settings.getByLabel("Định dạng", { exact: true }).selectOption("strip");
  await expect.poll(async () => (await saved()).page_format).toBe("strip");
  await expect(settings.getByText("Đã lưu", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Đóng" }).click();
  await openSettings();
  await expect(settings.getByLabel("Định dạng", { exact: true })).toHaveValue("strip");

  // Chữ bỏ qua (watermark): dòng quá ngắn báo lỗi tại dòng, không lưu; sửa xong rời ô thì lưu, mục trùng gộp lại.
  let patched = 0;
  page.on("request", (r) => r.method() === "PATCH" && r.url().includes(`/api/series/${seriesId}`) && patched++);
  const ignore = settings.getByLabel("Chữ bỏ qua (watermark)");
  await ignore.fill("discord.gg/nhom\nab");
  await expect(settings.getByText("Dòng 2: mỗi mục 3–100 ký tự (không tính http:// và dấu cách).")).toBeVisible();
  await settings.getByLabel("Tên series", { exact: true }).focus();
  // Rời ô khi còn dòng sai → không có lượt lưu nào.
  await page.waitForTimeout(1_200);
  expect(patched).toBe(0);
  await ignore.fill("discord.gg/nhom\nDISCORD.GG/NHOM\nNhóm Mèo");
  await settings.getByLabel("Tên series", { exact: true }).focus();
  await expect(ignore).toHaveValue("discord.gg/nhom\nNhóm Mèo");

  const s = await saved();
  expect([s.source_lang, s.target_lang, s.page_format]).toEqual(["en", "id", "strip"]);
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
    const row = page.locator(`.card[data-series="${s.id}"]`);
    const name = row.locator(".card-name");
    await expect(name).toHaveAttribute("title", title);
    await expect(row.locator(".card-state-text")).toContainText("Ch.1");
    // Tên dài tối đa 2 dòng (cắt "…"), thẻ không tràn khung nhìn.
    const clamp = await name.evaluate((el) => ({
      lines: Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)),
      width: el.getBoundingClientRect().width,
    }));
    expect(clamp.lines).toBeLessThanOrEqual(2);
    const box = await row.boundingBox();
    if (!box) throw new Error("card not laid out");
    expect(box.x + box.width).toBeLessThanOrEqual(width);
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

test("settings groups are always open; complete pronoun rows save while an incomplete row stays red on the form, text saves on leave", async ({
  page,
}) => {
  await login(page);
  const id = await apiSeries(page, "Series xưng hô e2e");
  const saved = async () =>
    (await (await page.request.get(`/api/series/${id}`)).json()) as {
      style_prompt: string;
      pronoun_rules: { speaker: string; listener: string; address: string }[];
    };
  try {
    await page.goto(`/s/${id}?tab=settings`);
    const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });
    for (const name of ["Series", "Hướng dẫn cho AI", "Font chữ", "Bỏ qua khi dịch"]) {
      await expect(settings.getByRole("region", { name })).toBeVisible();
    }
    for (const label of ["Tên series", "Dịch từ", "Sang", "Định dạng", "Giọng văn", "Kính ngữ", "Font thoại"]) {
      await expect(settings.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(settings.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
    const ai = settings.getByRole("region", { name: "Hướng dẫn cho AI" });
    await expect(ai.getByText("0 thuật ngữ")).toBeVisible();

    // Thêm quy tắc, bỏ trống rồi rời hàng → báo lỗi tại hàng, không gọi PATCH.
    let patched = 0;
    page.on("request", (r) => r.method() === "PATCH" && r.url().includes(`/api/series/${id}`) && patched++);
    const style = ai.getByLabel("Giọng văn", { exact: true });
    const rows = ai.locator("tbody tr");
    const missing = "Hàng tô đỏ chưa được lưu: điền đủ người nói, người nghe, xưng/gọi.";
    await ai.getByRole("button", { name: "+ Thêm quy tắc" }).click();
    await ai.getByLabel("Người nói", { exact: true }).fill("Minjun");
    await style.focus();
    await expect(ai.getByLabel("Người nghe", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(ai.getByText(missing)).toBeVisible();
    expect(patched).toBe(0);

    await ai.getByLabel("Người nghe", { exact: true }).fill("Seoyeon");
    await ai.getByLabel("Xưng / gọi", { exact: true }).fill("anh/em");
    await style.focus();
    await expect(settings.getByText("Đã lưu", { exact: true })).toBeVisible();
    await expect(ai.getByText(missing)).toHaveCount(0);
    expect((await saved()).pronoun_rules).toMatchObject([
      { speaker: "Minjun", listener: "Seoyeon", address: "anh/em" },
    ]);

    // Hàng thiếu không chặn lưu: thêm hàng điền dở, rồi xoá hàng đủ → lưu ngay danh sách rỗng, hàng dở vẫn ở trên form
    // (đỏ), kể cả khi bản server mới về.
    await ai.getByRole("button", { name: "+ Thêm quy tắc" }).click();
    await rows.nth(1).getByLabel("Người nói", { exact: true }).fill("Seoyeon");
    await style.focus();
    await expect(rows.nth(1).getByLabel("Người nghe", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await rows.first().getByRole("button", { name: "Xoá" }).click();
    await expect.poll(async () => (await saved()).pronoun_rules).toEqual([]);
    await style.focus();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByLabel("Người nói", { exact: true })).toHaveValue("Seoyeon");
    await expect(ai.getByText(missing)).toBeVisible();

    // Giọng văn chỉ lưu khi rời ô, không lưu giữa lúc gõ.
    const before = patched;
    await style.fill("giọng trẻ");
    await page.waitForTimeout(1_200);
    expect(patched).toBe(before);
    expect((await saved()).style_prompt).toBe("");
    await settings.getByLabel("Tên series", { exact: true }).focus();
    await expect.poll(async () => (await saved()).style_prompt).toBe("giọng trẻ");

    // Đóng modal: hàng điền dở bị bỏ, không gọi PATCH thêm.
    const afterStyle = patched;
    await settings.getByRole("button", { name: "Đóng" }).click();
    await expect(settings).toHaveCount(0);
    await page.goto(`/s/${id}?tab=settings`);
    await expect(rows).toHaveCount(0);
    expect(patched).toBe(afterStyle);
    expect((await saved()).pronoun_rules).toEqual([]);

    // Dòng Glossary mở modal glossary của series.
    await ai.getByRole("link", { name: "Mở" }).click();
    await expect(page).toHaveURL(/\?tab=glossary/);
    await expect(page.getByRole("dialog", { name: "Glossary của series" })).toBeVisible();
  } finally {
    await page.request.delete(`/api/series/${id}`, { headers });
  }
});

test("settings: the hint opens from the keyboard, Ảnh tự bỏ is shown, and Xoá series asks for the name only after a click", async ({
  page,
}) => {
  await login(page);
  const id = await apiSeries(page, "Series xoá trong cài đặt e2e");
  await page.goto(`/s/${id}?tab=settings`);
  const settings = page.getByRole("dialog", { name: "Cài đặt dịch" });

  // ⓘ: Tab tới nút thì lời giải thích hiện (và gắn vào nút qua aria-describedby).
  const tip = settings.getByRole("button", { name: "Giải thích Định dạng" });
  await tip.focus();
  await expect(settings.getByRole("tooltip")).toContainText("Áp dụng cho chương upload sau.");
  await expect(tip).toHaveAccessibleDescription(/Áp dụng cho chương upload sau/);
  await settings.getByLabel("Tên series").focus();
  await expect(settings.getByRole("tooltip")).toHaveCount(0);

  // Ảnh tự bỏ luôn hiện (không còn nhóm thu gọn).
  await expect(settings.getByRole("group", { name: "Ảnh tự bỏ" }).getByText("Chưa có ảnh nào.")).toBeVisible();

  // Xoá series: chỉ có link đỏ; ô gõ tên chỉ hiện sau khi bấm; Huỷ ẩn lại; gõ đúng tên mới xoá được.
  await expect(settings.getByLabel("Gõ tên series để xác nhận")).toHaveCount(0);
  await settings.getByRole("button", { name: "Xoá series", exact: true }).click();
  const name = settings.getByLabel("Gõ tên series để xác nhận");
  const confirm = settings.getByRole("button", { name: "Xoá vĩnh viễn" });
  await expect(confirm).toBeDisabled();
  await settings.getByRole("button", { name: "Huỷ" }).click();
  await expect(name).toHaveCount(0);
  await settings.getByRole("button", { name: "Xoá series", exact: true }).click();
  await name.fill("Series xoá trong cài đặt e2e");
  await confirm.click();
  await expect(page).toHaveURL(`${WEB_URL}/`);
  expect((await page.request.get(`/api/series/${id}`)).status()).toBe(404);
});

test("home at 1280: drop strip is 56px, series are cards, Hoạt động is hidden while nothing uploads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  const strip = page.getByRole("region", { name: "Tạo chương mới" });
  await expect(strip.getByText("Thả ảnh / ZIP")).toBeVisible();
  await expect(page.getByText("tự tạo chương")).toHaveCount(0);
  expect((await strip.boundingBox())?.height).toBeLessThanOrEqual(58);
  const row = page.locator(`.card[data-series="${state.seriesId}"]`);
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hoạt động/ })).toHaveCount(0);
  // Font, (Cài đặt cho admin) vẫn ở menu tài khoản.
  await page.locator("summary[aria-label='Tài khoản']").click();
  await expect(page.getByRole("link", { name: "Font", exact: true })).toBeVisible();
});

test("dropping the files again onto an unfinished-upload chapter card resumes the upload", async ({ page }) => {
  await login(page);
  const created = await page.request.post(`/api/chapters`, {
    headers,
    data: {
      series_id: state.seriesId,
      number: "9302",
      files: [{ name: "1.png", content_type: "image/png", bytes: PNG_1PX.length }],
    },
  });
  expect(created.status()).toBe(201);
  const { chapter } = (await created.json()) as { chapter: { id: string } };
  try {
    // Dấu "tab cũ đóng giữa chừng": chương nháp có ảnh khai báo nhưng chưa ảnh nào lên.
    await page.evaluate(
      (id) => localStorage.setItem(`mtl.upload.${id}`, JSON.stringify({ total: 1, done: [] })),
      chapter.id,
    );
    await page.goto(`/s/${state.seriesId}`);
    const row = page.locator(`.card[data-chapter="${chapter.id}"]`);
    await expect(row).toContainText("Upload dở");
    await expect(row).toContainText("Thả lại file để tải tiếp");

    const dataTransfer = await page.evaluateHandle(
      (bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], "1.png", { type: "image/png" }));
        return dt;
      },
      [...PNG_1PX],
    );
    await row.dispatchEvent("drop", { dataTransfer });
    await expect(row).toContainText("Chưa xử lý", { timeout: 30_000 });
    await expect(row).not.toContainText("Upload dở");
  } finally {
    await page.request.delete(`/api/chapters/${chapter.id}`, { headers });
  }
});
