/**
 * Cột phải màn series: tóm tắt cài đặt dịch ("Sửa" → `?tab=settings`) và glossary của series (thêm nhanh KO/VI,
 * 5 từ mới nhất, "Xem tất cả" → `?tab=glossary`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { createEntry, fetchGlossary, glossaryKey } from "../glossary/api.ts";
import type { Series } from "./api.ts";

const RECENT_TERMS = 5;

/** "PatrickHand-Regular" → "PatrickHand"; chưa chọn → mặc định hệ thống. */
const fontName = (id: string | undefined) => (id ? id.replace(/-(Regular|Variable|Bold)$/, "") : "Mặc định");

export function SeriesSidebar({ ws, series }: { ws: string; series: Series }) {
  const rule = series.pronoun_rules[0];
  return (
    <aside aria-label="Cài đặt dịch của series" className="series-side">
      <section className="card">
        <div className="card-head">
          <h2>Cài đặt dịch</h2>
          <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId: series.id }} search={{ tab: "settings" }}>
            Sửa
          </Link>
        </div>
        <dl>
          <dt>Font thoại</dt>
          <dd>{fontName(series.default_fonts.dialogue)}</dd>
          <dt>Font SFX</dt>
          <dd>{fontName(series.default_fonts.sfx)}</dd>
          <dt>Xưng hô chính</dt>
          <dd>{rule ? `${rule.speaker} → ${rule.listener}: ${rule.address}` : "Chưa đặt"}</dd>
          <dt>Giọng văn</dt>
          <dd>{series.style_prompt.trim() || "Chưa đặt"}</dd>
        </dl>
        <div className="small muted">Áp cho mọi chương dịch sau khi lưu; chương đã sửa tay không bị đổi.</div>
      </section>
      <GlossaryCard ws={ws} seriesId={series.id} />
    </aside>
  );
}

function GlossaryCard({ ws, seriesId }: { ws: string; seriesId: string }) {
  const qc = useQueryClient();
  const key = glossaryKey(ws, seriesId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchGlossary(ws, seriesId) });
  const [ko, setKo] = useState("");
  const [vi, setVi] = useState("");
  const add = useMutation({
    mutationFn: () =>
      createEntry(ws, seriesId, { source_term: ko.trim(), target_term: vi.trim(), note: "", case_sensitive: false }),
    onSuccess: () => {
      setKo("");
      setVi("");
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ko.trim() && vi.trim()) add.mutate();
  };
  const entries = q.data?.entries ?? [];
  const recent = [...entries].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, RECENT_TERMS);

  return (
    <section className="card" aria-label="Glossary của series">
      <div className="card-head">
        <h2>Glossary · {entries.length} từ</h2>
        <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId }} search={{ tab: "glossary" }}>
          Xem tất cả
        </Link>
      </div>
      <form onSubmit={submit}>
        <input aria-label="Từ gốc" placeholder="Từ gốc (KO)" value={ko} onChange={(e) => setKo(e.target.value)} />
        <input aria-label="Bản dịch" placeholder="Dịch (VI)" value={vi} onChange={(e) => setVi(e.target.value)} />
        <button type="submit" disabled={add.isPending || !ko.trim() || !vi.trim()}>
          Thêm
        </button>
      </form>
      {(q.error || add.error) && <span className="small error">{errorMessage(q.error ?? add.error)}</span>}
      {recent.length > 0 && (
        <table>
          <tbody>
            {recent.map((g) => (
              <tr key={g.id}>
                <td>{g.source_term}</td>
                <td>{g.target_term}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.data && entries.length === 0 && <span className="small muted">Chưa có từ nào.</span>}
    </section>
  );
}
