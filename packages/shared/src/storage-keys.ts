/**
 * Key storage bất biến, có revision — không bao giờ ghi đè object.
 * Object mồ côi (attempt thua) dọn bằng job GC sau MVP.
 */
export const storageKeys = {
  /** Slice gốc người dùng upload. */
  source: (user: string, ch: string, uploadId: string, ext: string) => `u/${user}/ch/${ch}/src/${uploadId}.${ext}`,
  /** Ảnh page logic sau ingest. */
  ingestPage: (user: string, ch: string, ingestRev: number, ord: number) =>
    `u/${user}/ch/${ch}/ingest/${ingestRev}/${ord}.png`,
  /** Ảnh đã xoá chữ; pages.clean_rev trỏ tới rev thắng. */
  clean: (user: string, page: string, rev: number) => `u/${user}/pg/${page}/clean/${rev}.png`,
  mask: (user: string, page: string, rev: number) => `u/${user}/pg/${page}/mask/${rev}.png`,
  /** Mask người vẽ trong editor. */
  userMask: (user: string, page: string, id: string) => `u/${user}/pg/${page}/user-mask/${id}.png`,
  export: (user: string, ch: string, jobId: string, ext: "zip" | "cbz") => `u/${user}/ch/${ch}/export/${jobId}.${ext}`,
  /** Bản sao ảnh credit series đã học (còn khi chương nguồn bị xoá); xoá series dọn cả `u/{user}/series/{id}/`. */
  seriesSkip: (user: string, series: string, id: string, ext: string) => `u/${user}/series/${series}/skip/${id}.${ext}`,
  /** Font tuỳ chỉnh của người dùng (TTF/OTF): presigned POST ghi thẳng vào đây, API kiểm rồi giữ nguyên key. */
  font: (user: string, uploadId: string) => `u/${user}/fonts/${uploadId}`,
} as const;

/** Prefix mọi object của một người dùng. */
export const userPrefix = (user: string) => `u/${user}/`;

/** Key có thuộc người dùng không — chặn ký URL cho key của người khác. */
export function keyBelongsToUser(key: string, user: string): boolean {
  return key.startsWith(userPrefix(user)) && !key.includes("..");
}
