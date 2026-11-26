/**
 * Bảng glossary của series, sửa tại chỗ + import/export CSV. Mọi thay đổi làm server tăng glossary_rev — lần dịch sau
 * dùng term mới. Entry AI tự thêm khi dịch có chip "AI" (mất khi sửa).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { AiTag } from "../../app/ai-tag.tsx";
import { useT } from "../../i18n/t.ts";
import { ApiError, apiErrorText, errorMessage } from "../../lib/api.ts";
import {
  createEntry,
  deleteEntry,
  type EntryInput,
  exportCsvUrl,
  fetchGlossary,
  type GlossaryEntry,
  type GlossaryScope,
  glossaryKey,
  importCsv,
  updateEntry,
} from "./api.ts";

const EMPTY: EntryInput = { source_term: "", target_term: "", note: "", case_sensitive: false };
type CsvRowError = Readonly<Record<string, unknown>> & { line: number };

export function GlossaryEditor({ scope }: { scope: GlossaryScope }) {
  const { t, tp, tNode } = useT();
  const qc = useQueryClient();
  const key = glossaryKey(scope);
  const q = useQuery({ queryKey: key, queryFn: () => fetchGlossary(scope) });
  const [draft, setDraft] = useState<EntryInput>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; v: EntryInput } | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [pendingReplace, setPendingReplace] = useState<File | null>(null);

  const done = (text?: string) => {
    if (text) setMessage({ tone: "info", text });
    void qc.invalidateQueries({ queryKey: ["glossary"] });
    void qc.invalidateQueries({ queryKey: ["series"] });
  };
  const fail = (e: unknown) => {
    // Lỗi từng dòng CSV: `{ line, error, params, message }` — dịch theo mã như lỗi API.
    const rows = e instanceof ApiError && Array.isArray(e.body.errors) ? (e.body.errors as CsvRowError[]) : undefined;
    setMessage({
      tone: "danger",
      text: rows?.length
        ? t("glossary.editor.csvError", {
            rows: `${rows
              .slice(0, 5)
              .map((r) => t("glossary.editor.csvRow", { line: r.line, message: apiErrorText(r) }))
              .join("; ")}${rows.length > 5 ? "…" : ""}`,
          })
        : errorMessage(e),
    });
  };

  const add = useMutation({
    mutationFn: () => createEntry(scope, draft),
    onSuccess: () => {
      setDraft(EMPTY);
      done();
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: (x: { id: string; v: EntryInput }) => updateEntry(x.id, x.v),
    onSuccess: () => {
      setEditing(null);
      done();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEntry(id),
    onSuccess: () => done(),
    onError: fail,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => importCsv(scope, await file.text(), mode),
    onSuccess: (r) => done(t("glossary.editor.imported", { created: r.created, updated: r.updated })),
    onError: fail,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    add.mutate();
  };

  const match = (e: GlossaryEntry) =>
    !filter ||
    e.source_term.toLowerCase().includes(filter.toLowerCase()) ||
    e.target_term.toLowerCase().includes(filter.toLowerCase());
  const entries = (q.data?.entries ?? []).filter(match);
  const total = q.data?.entries.length ?? 0;

  return (
    <div className="glossary">
      <form className="glossary-add" onSubmit={submit} aria-label={t("glossary.editor.addForm")}>
        <div>
          <label htmlFor="g-src">{t("glossary.editor.source")}</label>
          <input
            id="g-src"
            aria-label={t("glossary.editor.sourceNew")}
            placeholder={t("glossary.editor.sourcePlaceholder")}
            value={draft.source_term}
            onChange={(e) => setDraft({ ...draft, source_term: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="g-tgt">{t("glossary.editor.target")}</label>
          <input
            id="g-tgt"
            aria-label={t("glossary.editor.targetNew")}
            placeholder={t("glossary.editor.targetPlaceholder")}
            value={draft.target_term}
            onChange={(e) => setDraft({ ...draft, target_term: e.target.value })}
          />
        </div>
        <div className="grow">
          <label htmlFor="g-note">{t("glossary.editor.noteOptional")}</label>
          <input
            id="g-note"
            aria-label={t("glossary.editor.noteNew")}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.case_sensitive}
            onChange={(e) => setDraft({ ...draft, case_sensitive: e.target.checked })}
          />
          {t("glossary.editor.caseSensitive")}
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={add.isPending || !draft.source_term.trim() || !draft.target_term.trim()}
        >
          {t("glossary.editor.add")}
        </button>
      </form>

      <div className="glossary-tools">
        <input
          type="search"
          aria-label={t("glossary.editor.filterAria")}
          placeholder={t("glossary.editor.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="spacer" />
        <a className="btn" href={exportCsvUrl(scope)} download>
          {t("glossary.editor.exportCsv")}
        </a>
        <select
          aria-label={t("glossary.editor.importMode")}
          className="import-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as "merge" | "replace")}
          title={t("glossary.editor.csvFormat")}
        >
          <option value="merge">{t("glossary.editor.modeMerge")}</option>
          <option value="replace">{t("glossary.editor.modeReplace")}</option>
        </select>
        <label className="btn file-pick" title={t("glossary.editor.csvFormat")}>
          {t("glossary.editor.importCsv")}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // "Thay toàn bộ" xoá mọi mục hiện có → hỏi lại trước khi gửi.
              if (f && mode === "replace") setPendingReplace(f);
              else if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {pendingReplace && (
        <div className="notice danger row">
          <span>
            {tNode("glossary.editor.replaceConfirm", {
              entries: tp("glossary.editor.existingEntries", q.data?.entries.length ?? 0),
              file: <span className="mono">{pendingReplace.name}</span>,
            })}
          </span>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              upload.mutate(pendingReplace);
              setPendingReplace(null);
            }}
          >
            {t("glossary.editor.replaceAll")}
          </button>
          <button type="button" onClick={() => setPendingReplace(null)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
      {message && <p className={`notice ${message.tone}`}>{message.text}</p>}
      {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}

      {q.data && total === 0 ? (
        <div className="rows-empty rows">
          {tNode("glossary.editor.emptyHint", { columns: <span className="mono">source_term,target_term</span> })}
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t("glossary.editor.source")}</th>
              <th>{t("glossary.editor.target")}</th>
              <th>{t("glossary.editor.note")}</th>
              <th>{t("glossary.editor.colCase")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) =>
              editing?.id === e.id ? (
                <tr key={e.id}>
                  <td>
                    <input
                      aria-label={t("glossary.editor.source")}
                      value={editing.v.source_term}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, source_term: x.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={t("glossary.editor.target")}
                      value={editing.v.target_term}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, target_term: x.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={t("glossary.editor.note")}
                      value={editing.v.note}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, note: x.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t("glossary.editor.caseSensitiveAria")}
                      checked={editing.v.case_sensitive}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, case_sensitive: x.target.checked } })}
                    />
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn-primary" onClick={() => save.mutate(editing)}>
                      {t("common.save")}
                    </button>{" "}
                    <button type="button" onClick={() => setEditing(null)}>
                      {t("common.cancel")}
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td>
                    {e.source_term}
                    {e.origin === "ai" && <AiTag />}
                  </td>
                  <td>{e.target_term}</td>
                  <td className="muted">{e.note}</td>
                  <td>{e.case_sensitive ? t("glossary.editor.caseYes") : ""}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        setEditing({
                          id: e.id,
                          v: {
                            source_term: e.source_term,
                            target_term: e.target_term,
                            note: e.note,
                            case_sensitive: e.case_sensitive,
                          },
                        })
                      }
                    >
                      {t("common.edit")}
                    </button>
                    <button type="button" className="btn-ghost btn-danger" onClick={() => remove.mutate(e.id)}>
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              ),
            )}
            {q.data && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("glossary.editor.noMatch", { filter })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
