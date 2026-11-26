/**
 * Lấy chuỗi theo ngôn ngữ giao diện. Key phẳng có namespace theo feature (`common.save`, `chapter.upload.dropHint`,
 * `errors.<code>`); placeholder `{name}`. Key thiếu ở locale đang dùng → lấy bản gốc (`vi`).
 *
 * - `t` / `tp` / `tNode` là hàm thường: gọi được từ hàm thuần và unit test (đọc store lúc gọi).
 * - Trong component dùng `useT()` để vẽ lại khi đổi ngôn ngữ. Giá trị tính sẵn trong `useMemo` / hằng module-level sẽ
 *   giữ chữ cũ → đưa `locale` vào deps hoặc gọi `t()` lúc render.
 */
import { createElement, Fragment, type ReactNode } from "react";
import { useStore } from "zustand";
import { i18nStore } from "./i18n-store.ts";
import { BASE_MESSAGES, type MessageKey } from "./locales.ts";

export type { MessageKey } from "./locales.ts";
export type Params = Readonly<Record<string, string | number>>;
/** Key số nhiều = phần chung của `<key>.one` / `<key>.other` (… `.few`, `.many` nếu locale cần). */
export type PluralKey = { [K in MessageKey]: K extends `${infer Base}.other` ? Base : never }[MessageKey];

type Dict = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER = /\{(\w+)\}/g;

const current = (): Dict => i18nStore.getState().messages;
const base: Dict = BASE_MESSAGES;

/** Chuỗi của `key`: locale đang dùng → bản gốc → chính `key` (lộ ra để dễ thấy khi thiếu). */
const lookup = (key: string): string => current()[key] ?? base[key] ?? key;

/** Thay `{name}` bằng `params.name`; placeholder không có trong `params` giữ nguyên. */
function interpolate(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** Key có trong bản gốc (dùng khi key ghép từ dữ liệu, VD `errors.<mã lỗi API>`). */
export const hasMessage = (key: string): key is MessageKey => Object.hasOwn(base, key);

export function t(key: MessageKey, params?: Params): string {
  return interpolate(lookup(key), params);
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/**
 * Số nhiều theo `Intl.PluralRules` của locale đang dùng; `{count}` = `String(count)` trừ khi `params.count` có sẵn (vd
 * `fmtNumber(n)`). Thiếu nhóm của locale → `.other` cùng locale → bản gốc.
 */
export function tp(key: PluralKey, count: number, params?: Params): string {
  const { locale } = i18nStore.getState();
  const category = pluralCategory(locale, count);
  const own = current();
  const template =
    own[`${key}.${category}`] ??
    own[`${key}.other`] ??
    base[`${key}.${category}`] ??
    base[`${key}.other`] ??
    `${key}.other`;
  return interpolate(template, { count: String(count), ...params });
}

/**
 * Như `t` nhưng placeholder là phần tử JSX (`"Bấm {action} để tiếp"` + `{ action: <b>…</b> }`) — giữ đúng thứ tự từ của
 * từng ngôn ngữ thay vì ghép chuỗi. Trả mảng node (phần tử đã có `key`) để đặt thẳng làm children.
 */
export function tNode(key: MessageKey, nodes: Readonly<Record<string, ReactNode>>): ReactNode[] {
  const template = lookup(key);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const name = m[1] ?? "";
    if (!Object.hasOwn(nodes, name)) continue;
    if (m.index > last) out.push(template.slice(last, m.index));
    const node = nodes[name];
    out.push(typeof node === "string" ? node : createElement(Fragment, { key: `${name}-${out.length}` }, node));
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/** `t` / `tp` / `tNode` trong component + `locale` hiện tại; component vẽ lại khi đổi ngôn ngữ. */
export function useT() {
  const locale = useStore(i18nStore, (s) => s.locale);
  useStore(i18nStore, (s) => s.messages);
  return { t, tp, tNode, locale };
}
