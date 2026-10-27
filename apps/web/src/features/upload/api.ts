import { api } from "../../lib/api.ts";
import type { ChapterSummary } from "../series/api.ts";

export type PresignedTarget = {
  id: string;
  ord: number;
  url: string;
  fields: Record<string, string>;
  expires_at: string;
};

export const createChapter = (body: {
  series_id: string;
  number: string;
  title: string;
  /** dhash/width/height: dấu nhận dạng ảnh (bỏ trống khi không tính được) — server bỏ qua sẵn ảnh credit đã học. */
  files: { name: string; content_type: string; bytes: number; dhash?: string; width?: number; height?: number }[];
}) =>
  api<{ chapter: ChapterSummary; files: (PresignedTarget & { name: string })[] }>("/api/chapters", {
    method: "POST",
    body,
  });

export const presignAgain = (chapterId: string, fileIds: string[]) =>
  api<{ files: PresignedTarget[] }>(`/api/chapters/${chapterId}/presign`, {
    method: "POST",
    body: { file_ids: fileIds },
  });
