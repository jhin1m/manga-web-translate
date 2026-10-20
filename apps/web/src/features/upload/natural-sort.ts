/** So sánh tên tự nhiên: "2.png" < "10.png", "ch1/p2" < "ch1/p10"; không phân biệt hoa thường. */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export function naturalSortBy<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(key(a), key(b)));
}
