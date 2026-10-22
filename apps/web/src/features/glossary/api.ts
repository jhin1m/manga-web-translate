/**
 * Glossary riêng series hoặc glossary chung workspace theo cặp nguồn→đích (khớp apps/api/src/routes/glossary.ts).
 */
import { api, wsPath } from "../../lib/api.ts";
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

export const scopePath = (ws: string, scope: GlossaryScope, path = "") =>
  "seriesId" in scope
    ? wsPath(ws, `/series/${scope.seriesId}/glossary${path}`)
    : wsPath(ws, `/glossary${path}?source_lang=${scope.pair.source_lang}&target_lang=${scope.pair.target_lang}`);

/** Mọi key bắt đầu bằng `["glossary", ws]` — invalidate theo prefix đó làm mới cả hai cấp. */
export const glossaryKey = (ws: string, scope: GlossaryScope): readonly string[] =>
  "seriesId" in scope
    ? ["glossary", ws, scope.seriesId]
    : ["glossary", ws, "ws", scope.pair.source_lang, scope.pair.target_lang];

export const fetchGlossary = (ws: string, scope: GlossaryScope) =>
  api<{ entries: GlossaryEntry[]; inherited: GlossaryEntry[] }>(scopePath(ws, scope));
export const createEntry = (ws: string, scope: GlossaryScope, body: EntryInput) =>
  api<GlossaryEntry>(scopePath(ws, scope), { method: "POST", body });
export const updateEntry = (ws: string, id: string, body: Partial<EntryInput>) =>
  api<GlossaryEntry>(wsPath(ws, `/glossary/${id}`), { method: "PATCH", body });
export const deleteEntry = (ws: string, id: string) => api<void>(wsPath(ws, `/glossary/${id}`), { method: "DELETE" });
export const importCsv = (ws: string, scope: GlossaryScope, csv: string, mode: "merge" | "replace") =>
  api<{ created: number; updated: number }>(scopePath(ws, scope, "/csv"), { method: "POST", body: { csv, mode } });
export const exportCsvUrl = (ws: string, scope: GlossaryScope) => scopePath(ws, scope, "/csv");
