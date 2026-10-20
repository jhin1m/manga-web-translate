/** Glossary cấp workspace (`seriesId` null) hoặc cấp series (khớp apps/api/src/routes/glossary.ts). */
import { api, wsPath } from "../../lib/api.ts";

export type GlossaryEntry = {
  id: string;
  series_id: string | null;
  source_term: string;
  target_term: string;
  note: string;
  case_sensitive: boolean;
  updated_at: string;
};
export type EntryInput = Pick<GlossaryEntry, "source_term" | "target_term" | "note" | "case_sensitive">;

const scopePath = (ws: string, seriesId: string | null, path = "") =>
  wsPath(ws, seriesId ? `/series/${seriesId}/glossary${path}` : `/glossary${path}`);

export const glossaryKey = (ws: string, seriesId: string | null) => ["glossary", ws, seriesId ?? "ws"] as const;

export const fetchGlossary = (ws: string, seriesId: string | null) =>
  api<{ entries: GlossaryEntry[]; inherited: GlossaryEntry[] }>(scopePath(ws, seriesId));
export const createEntry = (ws: string, seriesId: string | null, body: EntryInput) =>
  api<GlossaryEntry>(scopePath(ws, seriesId), { method: "POST", body });
export const updateEntry = (ws: string, id: string, body: Partial<EntryInput>) =>
  api<GlossaryEntry>(wsPath(ws, `/glossary/${id}`), { method: "PATCH", body });
export const deleteEntry = (ws: string, id: string) => api<void>(wsPath(ws, `/glossary/${id}`), { method: "DELETE" });
export const importCsv = (ws: string, seriesId: string | null, csv: string, mode: "merge" | "replace") =>
  api<{ created: number; updated: number }>(scopePath(ws, seriesId, "/csv"), { method: "POST", body: { csv, mode } });
export const exportCsvUrl = (ws: string, seriesId: string | null) => scopePath(ws, seriesId, "/csv");
