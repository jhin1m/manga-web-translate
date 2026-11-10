/** Tên font dễ đọc cho ô chọn (giá trị lưu vẫn là id) và thứ tự font khuyên dùng. */

/** Font thoại dễ đọc, xếp đầu danh sách; font thiếu chữ của ngôn ngữ đích đã bị lọc trước khi tới đây. */
const RECOMMENDED = [
  "KomikaText-Regular",
  "WildWords-Roman",
  "MTOComic-Regular",
  "AnimeAce-Bold",
  "BeVietnamPro-Regular",
];

const words = (s: string) =>
  s
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2");

/** "MTOComic-Regular" → "MTO Comic"; "WildWords-BoldItalic" → "Wild Words Bold Italic". */
export function fontDisplayName(id: string): string {
  if (id.startsWith("custom-")) return id; // font riêng có tên thật ở danh sách font; chưa tải xong thì giữ nguyên id
  const [family = id, style] = id.split("-");
  const keepStyle = style && !/^(Regular|Variable|Roman)$/.test(style);
  return keepStyle ? `${words(family)} ${words(style)}` : words(family);
}

export function recommendedFirst(ids: readonly string[]): string[] {
  const set = new Set(ids);
  const first = RECOMMENDED.filter((id) => set.has(id));
  return [...first, ...ids.filter((id) => !first.includes(id))];
}
