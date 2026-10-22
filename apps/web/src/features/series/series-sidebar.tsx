/**
 * Cột phải màn series: tóm tắt cài đặt dịch ("Sửa" → `?tab=settings`) và glossary của series (thêm nhanh theo ngôn ngữ series,
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
          <dt>Font dẫn truyện</dt>
          <dd>{series.default_fonts.narration ? fontName(series.default_fonts.narration) : "Giống font thoại"}</dd>
          <dt>Xưng hô chính</dt>
          <dd>{rule ? `${rule.speaker} → ${rule.listener}: ${rule.address}` : "Chưa đặt"}</dd>
          <dt>Giọng văn</dt>
          <dd>{series.style_prompt.trim() || "Chưa đặt"}</dd>
        </dl>
        <div className="small muted">Áp cho mọi chương dịch sau khi lưu; chương đã sửa tay không bị đổi.</div>
      </section>
      <GlossaryCard ws={ws} series={series} />
    </aside>
  );
}

function GlossaryCard({ ws, series }: { ws: string; series: Series }) {
  const qc = useQueryClient();
  const seriesId = series.id;
  const scope = { seriesId };
  const key = glossaryKey(ws, scope);
  const q = useQuery({ queryKey: key, queryFn: () => fetchGlossary(ws, scope) });
  const [src, setSrc] = useState("");
  const [tgt, setTgt] = useState("");
  const add = useMutation({
    mutationFn: () =>
      createEntry(ws, scope, { source_term: src.trim(), target_term: tgt.trim(), note: "", case_sensitive: false }),
    onSuccess: () => {
      setSrc("");
      setTgt("");
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (src.trim() && tgt.trim()) add.mutate();
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
        <input
          aria-label="Từ gốc"
          placeholder={`Từ gốc (${series.source_lang.toUpperCase()})`}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
        />
        <input
          aria-label="Bản dịch"
          placeholder={`Dịch (${series.target_lang.toUpperCase()})`}
          value={tgt}
          onChange={(e) => setTgt(e.target.value)}
        />
        <button type="submit" disabled={add.isPending || !src.trim() || !tgt.trim()}>
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
