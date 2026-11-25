/**
 * Glossary riêng của series (khớp apps/api/src/routes/glossary.ts).
 */
import type { Origin } from "@mtl/shared";
import { api } from "../../lib/api.ts";

export type GlossaryEntry = {
  id: string;
  series_id: string;
  source_term: string;
  target_term: string;
  note: string;
  case_sensitive: boolean;
  /** Ai ghi: "ai" = AI tự thêm khi dịch (chip "AI"); sửa entry → server đặt "user". */
  origin: Origin;
  updated_at: string;
};
export type EntryInput = Pick<GlossaryEntry, "source_term" | "target_term" | "note" | "case_sensitive">;

export type GlossaryScope = { seriesId: string };

export const scopePath = (scope: GlossaryScope, path = "") => `/api/series/${scope.seriesId}/glossary${path}`;

/** Mọi key bắt đầu bằng `["glossary"]` — invalidate theo prefix đó làm mới glossary mọi series. */
export const glossaryKey = (scope: GlossaryScope): readonly string[] => ["glossary", scope.seriesId];

export const fetchGlossary = (scope: GlossaryScope) => api<{ entries: GlossaryEntry[] }>(scopePath(scope));
export const createEntry = (scope: GlossaryScope, body: EntryInput) =>
  api<GlossaryEntry>(scopePath(scope), { method: "POST", body });
export const updateEntry = (id: string, body: Partial<EntryInput>) =>
  api<GlossaryEntry>(`/api/glossary/${id}`, { method: "PATCH", body });
export const deleteEntry = (id: string) => api<void>(`/api/glossary/${id}`, { method: "DELETE" });
export const importCsv = (scope: GlossaryScope, csv: string, mode: "merge" | "replace") =>
  api<{ created: number; updated: number }>(scopePath(scope, "/csv"), { method: "POST", body: { csv, mode } });
export const exportCsvUrl = (scope: GlossaryScope) => scopePath(scope, "/csv");
