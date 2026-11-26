/**
 * Font cài trong máy qua Local Font Access API (`window.queryLocalFonts`, Chrome / Edge trên máy tính, trang https hoặc
 * localhost, người dùng bấm cho phép). Font chọn được upload như font riêng: worker vẽ ảnh xuất bằng đúng file font nên
 * không dùng thẳng font của máy được. Chỉ TTF / OTF (API từ chối TTC / WOFF), tối đa 10MB.
 */
import { t } from "../../i18n/t.ts";
import { MAX_FONT_BYTES } from "./api.ts";

export type LocalFont = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
};

type WithLocalFonts = { queryLocalFonts?: () => Promise<LocalFont[]> };

export const localFontsSupported = (): boolean =>
  typeof window !== "undefined" && typeof (window as WithLocalFonts).queryLocalFonts === "function";

/** Danh sách font trong máy, bỏ trùng (cùng postscriptName), xếp theo họ rồi kiểu. Trình duyệt hỏi quyền lần đầu. */
export async function queryLocalFonts(): Promise<LocalFont[]> {
  const query = (window as WithLocalFonts).queryLocalFonts;
  if (!query) throw new Error(t("fonts.localFonts.unsupported"));
  return uniqueFonts(await query.call(window));
}

export function uniqueFonts(list: readonly LocalFont[]): LocalFont[] {
  const seen = new Map<string, LocalFont>();
  for (const f of list) if (!seen.has(f.postscriptName)) seen.set(f.postscriptName, f);
  return [...seen.values()].sort(
    (a, b) =>
      a.family.localeCompare(b.family) || a.style.localeCompare(b.style) || a.fullName.localeCompare(b.fullName),
  );
}

/** Lọc theo tên (không phân biệt hoa thường, bỏ dấu). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const filterFonts = (list: readonly LocalFont[], q: string): LocalFont[] => {
  const needle = fold(q.trim());
  return needle ? list.filter((f) => fold(`${f.fullName} ${f.family}`).includes(needle)) : [...list];
};

/** Định dạng file theo 4 byte đầu (sfnt). */
export function sfntKind(head: Uint8Array): "ttf" | "otf" | "ttc" | null {
  const tag = String.fromCharCode(...head.slice(0, 4));
  if (tag === "\x00\x01\x00\x00" || tag === "true") return "ttf";
  if (tag === "OTTO") return "otf";
  if (tag === "ttcf") return "ttc";
  return null;
}

/** File font sẵn để upload; lỗi = câu nói rõ vì sao font này không thêm được. */
export async function localFontFile(f: LocalFont): Promise<File> {
  const blob = await f.blob();
  if (blob.size > MAX_FONT_BYTES) throw new Error(t("fonts.localFonts.tooLarge"));
  const kind = sfntKind(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
  if (kind === "ttc") throw new Error(t("fonts.localFonts.ttc"));
  if (!kind) throw new Error(t("fonts.localFonts.notSfnt"));
  return new File([blob], `${f.postscriptName}.${kind}`, { type: `font/${kind}` });
}
