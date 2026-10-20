/** Dùng chung cho các spec: state seed (global-setup) + đăng nhập bằng form rồi chờ home `/`. */
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { type E2EState, STATE_FILE } from "./env.ts";

export const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(state.email);
  await page.getByLabel("Mật khẩu").fill(state.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toBeVisible();
}
