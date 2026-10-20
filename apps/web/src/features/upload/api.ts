import { api, wsPath } from "../../lib/api.ts";
import type { ChapterSummary } from "../series/api.ts";

export type PresignedTarget = {
  id: string;
  ord: number;
  url: string;
  fields: Record<string, string>;
  expires_at: string;
};

export const createChapter = (
  ws: string,
  body: {
    series_id: string;
    number: string;
    title: string;
    files: { name: string; content_type: string; bytes: number }[];
  },
) =>
  api<{ chapter: ChapterSummary; files: (PresignedTarget & { name: string })[] }>(wsPath(ws, "/chapters"), {
    method: "POST",
    body,
  });

export const presignAgain = (ws: string, chapterId: string, fileIds: string[]) =>
  api<{ files: PresignedTarget[] }>(wsPath(ws, `/chapters/${chapterId}/presign`), {
    method: "POST",
    body: { file_ids: fileIds },
  });
