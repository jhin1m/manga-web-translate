/**
 * Key storage bất biến, có revision — không bao giờ ghi đè object.
 * Object mồ côi (attempt thua) dọn bằng job GC sau MVP.
 */
export const storageKeys = {
  /** Slice gốc người dùng upload. */
  source: (ws: string, ch: string, uploadId: string, ext: string) => `ws/${ws}/ch/${ch}/src/${uploadId}.${ext}`,
  /** Ảnh page logic sau ingest. */
  ingestPage: (ws: string, ch: string, ingestRev: number, ord: number) =>
    `ws/${ws}/ch/${ch}/ingest/${ingestRev}/${ord}.png`,
  /** Ảnh đã xoá chữ; pages.clean_rev trỏ tới rev thắng. */
  clean: (ws: string, page: string, rev: number) => `ws/${ws}/pg/${page}/clean/${rev}.png`,
  mask: (ws: string, page: string, rev: number) => `ws/${ws}/pg/${page}/mask/${rev}.png`,
  /** Mask người vẽ trong editor. */
  userMask: (ws: string, page: string, id: string) => `ws/${ws}/pg/${page}/user-mask/${id}.png`,
  export: (ws: string, ch: string, jobId: string, ext: "zip" | "cbz") => `ws/${ws}/ch/${ch}/export/${jobId}.${ext}`,
  /** Bản sao ảnh credit series đã học (còn khi chương nguồn bị xoá); xoá series dọn cả `ws/{ws}/series/{id}/`. */
  seriesSkip: (ws: string, series: string, id: string, ext: string) => `ws/${ws}/series/${series}/skip/${id}.${ext}`,
  /** Font tuỳ chỉnh của workspace (TTF/OTF): presigned POST ghi thẳng vào đây, API kiểm rồi giữ nguyên key. */
  font: (ws: string, uploadId: string) => `ws/${ws}/fonts/${uploadId}`,
} as const;

/** Key có thuộc workspace không — chặn ký URL cho key của workspace khác. */
export function keyBelongsToWorkspace(key: string, ws: string): boolean {
  return key.startsWith(`ws/${ws}/`) && !key.includes("..");
}
