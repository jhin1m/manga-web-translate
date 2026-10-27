/**
 * Glossary riêng series hoặc glossary chung theo cặp nguồn→đích (khớp apps/api/src/routes/glossary.ts).
 */
import { api } from "../../lib/api.ts";
import type { SourceLang, TargetLang } from "../series/lang-labels.ts";

export type GlossaryEntry = {
  id: string;
  series_id: string | null;
  /** Chỉ entry chung mang cặp; entry series là null. */
  source_lang: string | null;
  target_lang: string | null;
  source_term: string;
  target_term: string;
  note: string;
  case_sensitive: boolean;
  updated_at: string;
};
export type EntryInput = Pick<GlossaryEntry, "source_term" | "target_term" | "note" | "case_sensitive">;

export type LangPair = { source_lang: SourceLang; target_lang: TargetLang };
export type GlossaryScope = { seriesId: string } | { pair: LangPair };

export const scopePath = (scope: GlossaryScope, path = "") =>
  "seriesId" in scope
    ? `/api/series/${scope.seriesId}/glossary${path}`
    : `/api/glossary${path}?source_lang=${scope.pair.source_lang}&target_lang=${scope.pair.target_lang}`;

/** Mọi key bắt đầu bằng `["glossary"]` — invalidate theo prefix đó làm mới cả hai cấp. */
export const glossaryKey = (scope: GlossaryScope): readonly string[] =>
  "seriesId" in scope
    ? ["glossary", scope.seriesId]
    : ["glossary", "shared", scope.pair.source_lang, scope.pair.target_lang];

export const fetchGlossary = (scope: GlossaryScope) =>
  api<{ entries: GlossaryEntry[]; inherited: GlossaryEntry[] }>(scopePath(scope));
export const createEntry = (scope: GlossaryScope, body: EntryInput) =>
  api<GlossaryEntry>(scopePath(scope), { method: "POST", body });
export const updateEntry = (id: string, body: Partial<EntryInput>) =>
  api<GlossaryEntry>(`/api/glossary/${id}`, { method: "PATCH", body });
export const deleteEntry = (id: string) => api<void>(`/api/glossary/${id}`, { method: "DELETE" });
export const importCsv = (scope: GlossaryScope, csv: string, mode: "merge" | "replace") =>
  api<{ created: number; updated: number }>(scopePath(scope, "/csv"), { method: "POST", body: { csv, mode } });
export const exportCsvUrl = (scope: GlossaryScope) => scopePath(scope, "/csv");
