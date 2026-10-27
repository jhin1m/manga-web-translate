/**
 * Bảng glossary sửa tại chỗ + import/export CSV. Dùng cho cả glossary chung (theo cặp nguồn→đích, chọn ở trang
 * Glossary chung) và cấp series (series ghi đè entry chung cùng cặp trùng từ gốc). Mọi thay đổi làm server tăng
 * glossary_rev — lần dịch sau dùng term mới.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { LANG_NAMES, pairLabel, TARGET_LANGS, type TargetLang } from "../series/lang-labels.ts";
import { SourceLangSelect } from "../series/source-lang-select.tsx";
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
  type LangPair,
  updateEntry,
} from "./api.ts";

const EMPTY: EntryInput = { source_term: "", target_term: "", note: "", case_sensitive: false };

/** `inheritedLabel`: nhãn dòng kế thừa từ glossary chung (chỉ cấp series, VD "từ glossary chung (Hàn → Việt)"). */
export function GlossaryEditor({
  scope,
  inheritedLabel = "từ glossary chung",
}: {
  scope: GlossaryScope;
  inheritedLabel?: string;
}) {
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
    const rows = e instanceof ApiError ? (e.body.errors as { line: number; message: string }[] | undefined) : undefined;
    setMessage({
      tone: "danger",
      text: rows?.length
        ? `CSV lỗi: ${rows
            .slice(0, 5)
            .map((r) => `dòng ${r.line} (${r.message})`)
            .join("; ")}${rows.length > 5 ? "…" : ""}`
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
    onSuccess: (r) => done(`Đã nhập: thêm ${r.created}, cập nhật ${r.updated}.`),
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
  const overridden = new Set(q.data?.entries.map((e) => e.source_term));
  const inherited = (q.data?.inherited ?? []).filter(match);

  const total = (q.data?.entries.length ?? 0) + (q.data?.inherited.length ?? 0);

  return (
    <div className="glossary">
      <form className="glossary-add" onSubmit={submit} aria-label="Thêm từ vào glossary">
        <div>
          <label htmlFor="g-src">Từ gốc</label>
          <input
            id="g-src"
            aria-label="Từ gốc mới"
            placeholder="VD: 검"
            value={draft.source_term}
            onChange={(e) => setDraft({ ...draft, source_term: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="g-tgt">Bản dịch</label>
          <input
            id="g-tgt"
            aria-label="Bản dịch mới"
            placeholder="VD: kiếm"
            value={draft.target_term}
            onChange={(e) => setDraft({ ...draft, target_term: e.target.value })}
          />
        </div>
        <div className="grow">
          <label htmlFor="g-note">Ghi chú (tuỳ chọn)</label>
          <input
            id="g-note"
            aria-label="Ghi chú mới"
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
          Phân biệt hoa/thường
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={add.isPending || !draft.source_term.trim() || !draft.target_term.trim()}
        >
          Thêm
        </button>
      </form>

      <div className="glossary-tools">
        <input
          type="search"
          aria-label="Lọc glossary"
          placeholder="Lọc từ…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="spacer" />
        <a className="btn" href={exportCsvUrl(scope)} download>
          Xuất CSV
        </a>
        <select
          aria-label="Chế độ nhập"
          className="import-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as "merge" | "replace")}
          title="CSV: cột source_term, target_term, note, case_sensitive (UTF-8)"
        >
          <option value="merge">Nhập: gộp theo từ gốc</option>
          <option value="replace">Nhập: thay toàn bộ</option>
        </select>
        <label className="btn file-pick" title="CSV: cột source_term, target_term, note, case_sensitive (UTF-8)">
          Nhập CSV…
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
            Thay toàn bộ {q.data?.entries.length ?? 0} mục hiện có bằng nội dung{" "}
            <span className="mono">{pendingReplace.name}</span>?
          </span>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              upload.mutate(pendingReplace);
              setPendingReplace(null);
            }}
          >
            Thay toàn bộ
          </button>
          <button type="button" onClick={() => setPendingReplace(null)}>
            Huỷ
          </button>
        </div>
      )}
      {message && <p className={`notice ${message.tone}`}>{message.text}</p>}
      {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}

      {q.data && total === 0 ? (
        <div className="rows-empty rows">
          Chưa có từ nào. Thêm ở trên, hoặc nhập file CSV (cột <span className="mono">source_term,target_term</span>).
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Từ gốc</th>
              <th>Bản dịch</th>
              <th>Ghi chú</th>
              <th>Hoa/thường</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) =>
              editing?.id === e.id ? (
                <tr key={e.id}>
                  <td>
                    <input
                      aria-label="Từ gốc"
                      value={editing.v.source_term}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, source_term: x.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Bản dịch"
                      value={editing.v.target_term}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, target_term: x.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Ghi chú"
                      value={editing.v.note}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, note: x.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label="Phân biệt hoa thường"
                      checked={editing.v.case_sensitive}
                      onChange={(x) => setEditing({ id: e.id, v: { ...editing.v, case_sensitive: x.target.checked } })}
                    />
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn-primary" onClick={() => save.mutate(editing)}>
                      Lưu
                    </button>{" "}
                    <button type="button" onClick={() => setEditing(null)}>
                      Huỷ
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td>{e.source_term}</td>
                  <td>{e.target_term}</td>
                  <td className="muted">{e.note}</td>
                  <td>{e.case_sensitive ? "Có" : ""}</td>
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
                      Sửa
                    </button>
                    <button type="button" className="btn-ghost btn-danger" onClick={() => remove.mutate(e.id)}>
                      Xoá
                    </button>
                  </td>
                </tr>
              ),
            )}
            {inherited.map((e) => (
              <tr key={e.id} className="muted">
                <td>{e.source_term}</td>
                <td>{e.target_term}</td>
                <td>{e.note}</td>
                <td>{e.case_sensitive ? "Có" : ""}</td>
                <td className="small" style={{ textAlign: "right" }}>
                  {overridden.has(e.source_term) ? "bị series ghi đè" : inheritedLabel}
                </td>
              </tr>
            ))}
            {q.data && entries.length + inherited.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Không có từ nào khớp “{filter}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Glossary chung của một cặp nguồn→đích (cặp giữ trong URL `?src=&tgt=`, route đổi khi chọn). */
export function GlossaryPage(props: { pair: LangPair; onPairChange: (p: LangPair) => void }) {
  const { pair, onPairChange } = props;
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Glossary chung</h1>
        <span className="spacer" />
        <SourceLangSelect value={pair.source_lang} onChange={(v) => onPairChange({ ...pair, source_lang: v })} />
        <span aria-hidden="true">→</span>
        <select
          aria-label="Ngôn ngữ đích"
          value={pair.target_lang}
          onChange={(e) => onPairChange({ ...pair, target_lang: e.target.value as TargetLang })}
        >
          {TARGET_LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">Áp cho series dịch {pairLabel(pair)}; entry trùng ở series sẽ ghi đè.</p>
      {/* key: đổi cặp = bảng mới (bỏ nháp, bản sửa dở và xác nhận "thay toàn bộ" của cặp cũ). */}
      <GlossaryEditor key={`${pair.source_lang}-${pair.target_lang}`} scope={{ pair }} />
    </div>
  );
}
