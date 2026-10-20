/**
 * Bảng glossary sửa tại chỗ + import/export CSV. Dùng cho cả cấp workspace và cấp series (series ghi đè
 * entry workspace trùng từ gốc). Mọi thay đổi làm server tăng glossary_rev — lần dịch sau dùng term mới.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, errorMessage } from "../../lib/api.ts";
import {
  createEntry,
  deleteEntry,
  type EntryInput,
  exportCsvUrl,
  fetchGlossary,
  type GlossaryEntry,
  glossaryKey,
  importCsv,
  updateEntry,
} from "./api.ts";

const EMPTY: EntryInput = { source_term: "", target_term: "", note: "", case_sensitive: false };

export function GlossaryEditor({ ws, seriesId }: { ws: string; seriesId: string | null }) {
  const qc = useQueryClient();
  const key = glossaryKey(ws, seriesId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchGlossary(ws, seriesId) });
  const [draft, setDraft] = useState<EntryInput>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; v: EntryInput } | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [pendingReplace, setPendingReplace] = useState<File | null>(null);

  const done = (text?: string) => {
    if (text) setMessage({ tone: "info", text });
    void qc.invalidateQueries({ queryKey: ["glossary", ws] });
    void qc.invalidateQueries({ queryKey: ["series", ws] });
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
    mutationFn: () => createEntry(ws, seriesId, draft),
    onSuccess: () => {
      setDraft(EMPTY);
      done();
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: (x: { id: string; v: EntryInput }) => updateEntry(ws, x.id, x.v),
    onSuccess: () => {
      setEditing(null);
      done();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEntry(ws, id),
    onSuccess: () => done(),
    onError: fail,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => importCsv(ws, seriesId, await file.text(), mode),
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

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          aria-label="Lọc glossary"
          placeholder="Lọc…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 200 }}
        />
        <span className="spacer" style={{ flex: 1 }} />
        <a className="btn" href={exportCsvUrl(ws, seriesId)} download>
          Xuất CSV
        </a>
        <select
          aria-label="Chế độ nhập"
          value={mode}
          onChange={(e) => setMode(e.target.value as "merge" | "replace")}
          style={{ width: "auto" }}
        >
          <option value="merge">Nhập: gộp theo từ gốc</option>
          <option value="replace">Nhập: thay toàn bộ</option>
        </select>
        <label className="btn" style={{ margin: 0, color: "inherit" }}>
          Nhập CSV…
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
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
      <p className="muted small" style={{ margin: "0 0 8px" }}>
        CSV: cột <span className="mono">source_term,target_term,note,case_sensitive</span> (UTF-8).
      </p>
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

      <form onSubmit={submit}>
        <table className="data">
          <thead>
            <tr>
              <th>Từ gốc</th>
              <th>Bản dịch</th>
              <th>Ghi chú</th>
              <th title="Phân biệt hoa thường">Aa</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input
                  aria-label="Từ gốc mới"
                  value={draft.source_term}
                  onChange={(e) => setDraft({ ...draft, source_term: e.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label="Bản dịch mới"
                  value={draft.target_term}
                  onChange={(e) => setDraft({ ...draft, target_term: e.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label="Ghi chú mới"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label="Phân biệt hoa thường"
                  checked={draft.case_sensitive}
                  onChange={(e) => setDraft({ ...draft, case_sensitive: e.target.checked })}
                />
              </td>
              <td style={{ textAlign: "right" }}>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={add.isPending || !draft.source_term.trim() || !draft.target_term.trim()}
                >
                  Thêm
                </button>
              </td>
            </tr>
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
                  <td>{e.case_sensitive ? "✓" : ""}</td>
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
                <td>{e.case_sensitive ? "✓" : ""}</td>
                <td className="small" style={{ textAlign: "right" }}>
                  {overridden.has(e.source_term) ? "bị series ghi đè" : "từ glossary chung"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>
      {q.data && entries.length + inherited.length === 0 && <p className="muted small">Chưa có mục nào.</p>}
    </div>
  );
}

export function WorkspaceGlossaryPage({ ws }: { ws: string }) {
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Glossary chung</h1>
      </div>
      <p className="muted small">Áp cho mọi series của workspace; entry trùng ở series sẽ ghi đè.</p>
      <GlossaryEditor ws={ws} seriesId={null} />
    </div>
  );
}
