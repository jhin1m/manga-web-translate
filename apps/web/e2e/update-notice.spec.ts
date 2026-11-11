/**
 * Menu tài khoản của bản self-host: dòng phiên bản, chấm báo bản mới, hộp "Cập nhật ngay" / "Cách cập nhật".
 * API e2e chạy nhiều người dùng (route update trả 404) nên `/api/config` và `/api/admin/update` được mock bằng
 * `page.route`; phiên đăng nhập thật có từ trước khi mock bật.
 */
import type { UpdateRun, UpdateStatus } from "@mtl/shared/update";
import { expect, type Page, type Route, test } from "@playwright/test";
import { login } from "./helpers.ts";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const latest = {
  version: "0.4.0",
  name: "v0.4.0",
  url: "https://github.com/jhin1m/manga-web-translate/releases/tag/v0.4.0",
  source: "github" as const,
};

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: "0.3.0",
  check: "ok",
  latest,
  update_available: true,
  pinned_tag: null,
  updater: { ready: true, reason: null, project: "mtl-local", run: null },
  ...over,
});

const run = (over: Partial<UpdateRun> = {}): UpdateRun => ({
  state: "running",
  target: "0.4.0",
  from: "0.3.0",
  step: "pull",
  started_at: new Date().toISOString(),
  finished_at: null,
  exit_code: null,
  reason: null,
  log_tail: [],
  ...over,
});

/** Đăng nhập thật rồi mới mock (bản nhiều người dùng cần phiên cho /api/me), sau đó mở lại `/`. */
async function open(page: Page, handler: (route: Route) => Promise<void>, version = "0.3.0") {
  await login(page);
  await page.route("**/api/config", (route) => json(route, { local_mode: true, version }));
  await page.route("**/api/admin/update", handler);
  await page.goto("/");
}

// Số phần tử trực tiếp của thanh trên: bản mới không được thêm phần tử nào.
const topClickables = (page: Page) => page.locator(".shell-top > *").count();

test("a new release puts a dot on the avatar, shows the release link, and the dot is gone after viewing the menu", async ({
  page,
}) => {
  await open(page, (route) => json(route, status()));
  const dot = page.getByTestId("update-dot");
  await expect(dot).toBeVisible();
  const before = await topClickables(page);
  expect(before).toBe(3);

  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await expect(page.getByTestId("version-line")).toHaveText("MTL v0.3.0");
  await expect(page.getByText("Có bản mới", { exact: false })).toContainText("v0.4.0");
  await expect(page.getByRole("link", { name: "Xem thay đổi" })).toHaveAttribute("href", latest.url);
  await expect(page.getByRole("button", { name: "Cập nhật ngay" })).toBeVisible();
  await expect(dot).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("Tài khoản", { exact: true })).toBeVisible();
  await expect(page.getByTestId("update-dot")).toHaveCount(0);
  expect(await topClickables(page)).toBe(before);
});

test("without a ready updater the button is 'Cách cập nhật' and the dialog lists three commands", async ({ page }) => {
  await open(page, (route) =>
    json(route, status({ updater: { ready: false, reason: "unavailable", project: null, run: null } })),
  );
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await expect(page.getByRole("button", { name: "Cập nhật ngay" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cách cập nhật" }).click();

  const dialog = page.getByRole("dialog", { name: "Cách cập nhật" });
  await expect(dialog).toContainText("chưa có bộ cập nhật");
  const lines = (await dialog.getByTestId("manual-commands").innerText()).split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(
    /^curl(\.exe)? -fsSLO https:\/\/raw\.githubusercontent\.com\/.+\/main\/docker-compose\.yml$/,
  );
  expect(lines.slice(1)).toEqual(["docker compose pull", "docker compose up -d"]);
});

test("the copy button does not throw without navigator.clipboard and asks to copy by hand", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await open(page, (route) =>
    json(route, status({ updater: { ready: false, reason: "unavailable", project: null, run: null } })),
  );
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cách cập nhật" }).click();
  const dialog = page.getByRole("dialog", { name: "Cách cập nhật" });
  await dialog.getByRole("button", { name: "Chép" }).click();
  await expect(dialog).toContainText("Hãy chọn và chép tay");
  expect(errors).toEqual([]);
});

test("update now: confirm, POST, pull step, app goes offline, /api/config reports the new version, page reloads", async ({
  page,
}) => {
  let phase: "idle" | "pull" | "offline" = "idle";
  let posted: unknown = null;
  let statusCalls = 0;
  let configCalls = 0;
  let upgraded = false;

  await login(page);
  await page.route("**/api/config", (route) => {
    if (phase === "offline") {
      configCalls++;
      // Hai lần đầu app còn đang khởi động lại (không trả lời), sau đó trả bản mới.
      if (configCalls <= 2) return route.abort("connectionrefused");
      upgraded = true;
    }
    return json(route, { local_mode: true, version: upgraded ? "0.4.0" : "0.3.0" });
  });
  await page.route("**/api/admin/update", (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON();
      phase = "pull";
      return json(route, { run: run({ step: "preflight" }) }, 202);
    }
    if (upgraded) {
      return json(
        route,
        status({
          current: "0.4.0",
          update_available: false,
          updater: { ready: true, reason: null, project: "mtl-local", run: run({ state: "succeeded", step: "done" }) },
        }),
      );
    }
    if (phase === "idle") return json(route, status());
    statusCalls++;
    if (statusCalls === 1)
      return json(route, status({ updater: { ready: true, reason: null, project: "mtl-local", run: run() } }));
    phase = "offline";
    return route.abort("connectionrefused");
  });

  const navigations: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest()) navigations.push(r.url());
  });
  await page.goto("/");

  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  const dialog = page.getByRole("dialog", { name: "Cập nhật lên v0.4.0" });
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  const navBefore = navigations.length;
  await dialog.getByRole("button", { name: "Cập nhật", exact: true }).click();

  await expect(dialog).toContainText("Đang kiểm tra");
  // Không đóng được giữa chừng.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Đóng" })).toBeHidden();
  await expect(dialog).toContainText("Đang tải bản mới. Trong lúc này app vẫn chạy.");
  await expect(dialog).toContainText("Đang khởi động lại");

  await expect.poll(() => navigations.length, { timeout: 30_000 }).toBeGreaterThan(navBefore);
  expect(posted).toEqual({ version: "0.4.0" });
  await expect(page.getByLabel("Tài khoản", { exact: true })).toBeVisible();
  await page.getByLabel("Tài khoản", { exact: true }).click();
  await expect(page.getByTestId("version-line")).toHaveText("MTL v0.4.0");
});

test("the dialog survives a failing /api/me refetch while the app restarts, then reloads on the new version", async ({
  page,
}) => {
  let phase: "idle" | "tracking" = "idle";
  let released = false;
  let meFailures = 0;
  let statusCalls = 0;

  await page.clock.install();
  await login(page);
  await page.route("**/api/me", (route) => {
    if (phase === "tracking" && !released) {
      meFailures++;
      return route.abort("connectionrefused");
    }
    return route.fallback();
  });
  await page.route("**/api/config", (route) =>
    phase === "tracking" && !released
      ? route.abort("connectionrefused")
      : json(route, { local_mode: true, version: released ? "0.4.0" : "0.3.0" }),
  );
  await page.route("**/api/admin/update", (route) => {
    if (route.request().method() === "POST") {
      phase = "tracking";
      return json(route, { run: run({ step: "preflight" }) }, 202);
    }
    if (released) {
      return json(
        route,
        status({
          current: "0.4.0",
          update_available: false,
          updater: { ready: true, reason: null, project: "mtl-local", run: run({ state: "succeeded", step: "done" }) },
        }),
      );
    }
    if (phase === "idle") return json(route, status());
    statusCalls++;
    if (statusCalls === 1)
      return json(route, status({ updater: { ready: true, reason: null, project: "mtl-local", run: run() } }));
    return route.abort("connectionrefused");
  });

  const navigations: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest()) navigations.push(r.url());
  });
  await page.goto("/");
  await page.clock.resume();

  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  const dialog = page.getByRole("dialog", { name: "Cập nhật lên v0.4.0" });
  await dialog.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(dialog).toContainText("Đang kiểm tra");

  // `me` đã cũ và app đang tắt: quay lại tab làm nó hỏi lại và lỗi.
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => meFailures, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Không tải được tài khoản")).toHaveCount(0);

  const navBefore = navigations.length;
  released = true;
  await expect.poll(() => navigations.length, { timeout: 30_000 }).toBeGreaterThan(navBefore);
});

test("the app already on the new version but the run failed afterwards: error stays until closed, closing reloads", async ({
  page,
}) => {
  let started = false;
  let statusCalls = 0;
  await open(page, (route) => {
    if (route.request().method() === "POST") {
      started = true;
      return json(route, { run: run({ step: "preflight" }) }, 202);
    }
    if (!started) return json(route, status());
    statusCalls++;
    const failed = run({ state: "failed", step: "check", reason: "up_failed", log_tail: ["worker unhealthy"] });
    return json(
      route,
      statusCalls === 1
        ? status({ updater: { ready: true, reason: null, project: "mtl-local", run: run() } })
        : status({ current: "0.4.0", updater: { ready: true, reason: null, project: "mtl-local", run: failed } }),
    );
  });
  const navigations: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest()) navigations.push(r.url());
  });
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cập nhật", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Đã lên v0.4.0, bước cuối lỗi" });
  await expect(dialog).toContainText("App đã chạy bản v0.4.0");
  await expect(dialog).toContainText("Worker hoặc tiến trình nền chưa chạy lại được");
  await expect(dialog).not.toContainText("App chưa chạy lại được");
  await expect(dialog).toContainText("docker logs mtl-local-update");
  const count = navigations.length;
  await page.waitForTimeout(1500);
  expect(navigations.length).toBe(count);
  // Closing the dialog loads the new web bundle instead of leaving the old page running.
  await page.keyboard.press("Escape");
  await expect.poll(() => navigations.length).toBeGreaterThan(count);
});

test("the confirm dialog cannot be closed while the POST is in flight", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open(page, async (route) => {
    if (route.request().method() !== "POST") return json(route, status());
    await gate;
    return json(route, { run: run({ step: "pull" }) }, 202);
  });
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  const dialog = page.getByRole("dialog", { name: "Cập nhật lên v0.4.0" });
  await dialog.getByRole("button", { name: "Cập nhật", exact: true }).click();

  await expect(dialog).toContainText("Đang gửi yêu cầu");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Đóng" })).toBeHidden();

  release();
  await expect(dialog).toContainText("Đang tải bản mới");
});

test("a POST that fails while the updater already started the run switches to tracking", async ({ page }) => {
  let posted = false;
  await open(page, (route) => {
    if (route.request().method() === "POST") {
      posted = true;
      return json(route, { error: "unavailable", reason: "unavailable" }, 503);
    }
    return json(
      route,
      posted
        ? status({ updater: { ready: true, reason: null, project: "mtl-local", run: run({ step: "pull" }) } })
        : status(),
    );
  });
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cập nhật", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Cập nhật lên v0.4.0" });
  await expect(dialog).toContainText("Đang tải bản mới");
  await expect(page.getByRole("dialog", { name: "Cập nhật v0.4.0 lỗi" })).toHaveCount(0);
});

test("a failed run shows the reason, the log command and the technical details", async ({ page }) => {
  const failed = run({
    state: "failed",
    step: "pull",
    reason: "pull_failed",
    exit_code: 1,
    log_tail: ["pull access denied", "exit 1"],
    finished_at: new Date().toISOString(),
  });
  await open(page, (route) =>
    json(route, status({ updater: { ready: true, reason: null, project: "mtl-local", run: failed } })),
  );
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật v0.4.0 lỗi" }).click();

  const dialog = page.getByRole("dialog", { name: "Cập nhật v0.4.0 lỗi" });
  await expect(dialog).toContainText("Không tải được bản mới");
  await expect(dialog).toContainText("docker logs mtl-local-update");
  await expect(dialog.getByText("pull access denied")).toBeHidden();
  await dialog.getByText("Chi tiết kỹ thuật").click();
  await expect(dialog.getByText("pull access denied")).toBeVisible();
  await expect(dialog.getByTestId("manual-commands")).toBeVisible();
});

test("a POST refused by the cooldown with nothing running says to wait instead of tracking", async ({ page }) => {
  await open(page, (route) =>
    route.request().method() === "POST"
      ? json(route, { error: "cooldown", reason: "cooldown" }, 429)
      : json(route, status()),
  );
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cập nhật", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cập nhật v0.4.0 lỗi" });
  await expect(dialog).toContainText("Vừa thử cập nhật. Đợi một phút rồi thử lại.");
  await expect(dialog).not.toContainText("Không tải được bản mới");
});

test("a start error from the API ends in the error dialog", async ({ page }) => {
  await open(page, (route) =>
    route.request().method() === "POST" ? json(route, { error: "up_failed" }, 500) : json(route, status()),
  );
  await page.getByLabel("Tài khoản · có bản mới v0.4.0").click();
  await page.getByRole("button", { name: "Cập nhật ngay" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Cập nhật v0.4.0 lỗi" })).toContainText("App chưa chạy lại được");
});

test("no new release: no dot, the menu only adds the version line", async ({ page }) => {
  await open(page, (route) => json(route, status({ update_available: false, latest: null, check: "ok" })));
  await expect(page.getByLabel("Tài khoản", { exact: true })).toBeVisible();
  await expect(page.getByTestId("update-dot")).toHaveCount(0);
  expect(await topClickables(page)).toBe(3);

  await page.getByLabel("Tài khoản", { exact: true }).click();
  await expect(page.getByTestId("version-line")).toHaveText("MTL v0.3.0");
  await expect(page.getByRole("button", { name: /Cập nhật|Cách cập nhật/ })).toHaveCount(0);
  await expect(page.getByText("Có bản mới")).toHaveCount(0);
});

test("the update route answering 404 hides everything; a dev build shows 'MTL dev'", async ({ page }) => {
  await open(page, (route) => json(route, { error: "not_found" }, 404), "dev");
  await page.getByLabel("Tài khoản", { exact: true }).click();
  await expect(page.getByTestId("version-line")).toHaveText("MTL dev");
  await expect(page.getByTestId("update-dot")).toHaveCount(0);
  await expect(page.getByText("Có bản mới")).toHaveCount(0);
});
