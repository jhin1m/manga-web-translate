/**
 * Tab "Áp glossary" ở bảng dưới màn chương — áp lại glossary vào bản dịch có sẵn (không gọi LLM): mỗi entry của glossary series (series đè workspace) có
 * ô "cụm cũ trong bản dịch" (mặc định = từ gốc để bắt chữ chưa dịch). Chọn entry → xem trước → áp dụng → hoàn tác.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { applyGlossaryRules, type GlossaryRule, previewGlossaryApply } from "../chapter/api.ts";
import { FlowPanel, type ToolPanelProps, useBatchFlow } from "../chapter/FindReplace.tsx";
import { LockBanner } from "../chapter/lock-banner.tsx";
import { fetchGlossary, type GlossaryEntry, glossaryKey } from "./api.ts";

/** Gộp glossary: entry series đè entry workspace trùng từ gốc (không phân biệt hoa thường). */
export function mergeGlossary(entries: GlossaryEntry[], inherited: GlossaryEntry[]): GlossaryEntry[] {
  const own = new Set(entries.map((e) => e.source_term.toLowerCase()));
  return [...entries, ...inherited.filter((e) => !own.has(e.source_term.toLowerCase()))];
}

export function ApplyGlossaryPanel(props: ToolPanelProps) {
  const { ws, seriesId, chapterId, lock, beforeWrite, onJump } = props;
  const q = useQuery({ queryKey: glossaryKey(ws, seriesId), queryFn: () => fetchGlossary(ws, seriesId) });
  const entries = useMemo(() => (q.data ? mergeGlossary(q.data.entries, q.data.inherited) : []), [q.data]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState<Record<string, string>>({});

  const rules: GlossaryRule[] = entries
    .filter((e) => picked.has(e.id))
    .map((e) => ({ source_term: e.source_term, from: (from[e.id] ?? e.source_term).trim() || e.source_term }));
  // Chỉ số rule trong request → entry, để highlight đúng cụm cũ/mới của từng khớp.
  const picks = entries.filter((e) => picked.has(e.id));

  const flow = useBatchFlow(
    { ws, chapterId },
    {
      input: rules,
      beforeWrite,
      preview: (r) => previewGlossaryApply(ws, chapterId, r),
      apply: (r, versions) => applyGlossaryRules(ws, chapterId, r, versions),
    },
  );
  const [used, setUsed] = useState<{ from: string; to: string }[]>([]);
  const touch = () => flow.invalidate();

  return (
    <div className="cw-tool">
      <LockBanner state={lock.state} onRetry={() => void lock.retry()} />
      <p className="muted small" style={{ marginTop: 0 }}>
        Thay “cụm cũ” bằng bản dịch trong glossary, chỉ ở vùng có chữ gốc chứa từ gốc. Không gọi AI. Muốn dịch lại theo
        glossary mới: dùng “Dịch lại cả chương”.{" "}
        <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId }} search={{ tab: "glossary" }}>
          Sửa glossary series
        </Link>
      </p>
      {q.isError && <p className="notice danger">{errorMessage(q.error)}</p>}
      {q.isLoading && <p className="muted small">Đang tải glossary…</p>}
      {q.data && entries.length === 0 && <p className="muted">Series chưa có thuật ngữ nào.</p>}
      {entries.length > 0 && (
        <div className="cw-tool-list">
          <table className="data">
            <thead>
              <tr>
                <th />
                <th>Từ gốc</th>
                <th>Bản dịch (glossary)</th>
                <th>Cụm cũ trong bản dịch</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${e.source_term}`}
                      checked={picked.has(e.id)}
                      onChange={() => {
                        const n = new Set(picked);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        setPicked(n);
                        touch();
                      }}
                    />
                  </td>
                  <td>{e.source_term}</td>
                  <td>{e.target_term}</td>
                  <td>
                    <input
                      aria-label={`Cụm cũ của ${e.source_term}`}
                      value={from[e.id] ?? e.source_term}
                      maxLength={200}
                      onChange={(ev) => {
                        setFrom({ ...from, [e.id]: ev.target.value });
                        touch();
                      }}
                    />
                  </td>
                  <td className="small muted">{e.series_id ? "Series" : "Workspace"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FlowPanel
        onJump={onJump}
        showRule
        flow={{
          ...flow,
          runPreview: () => {
            setUsed(picks.map((e, i) => ({ from: rules[i]?.from ?? e.source_term, to: e.target_term })));
            flow.runPreview();
          },
        }}
        lock={lock.state}
        canPreview={rules.length > 0 && rules.length <= 200}
        highlight={(m) => {
          const r = used[m.rule ?? 0];
          return { before: r?.from ?? "", after: r?.to ?? "", caseSensitive: false };
        }}
      />
    </div>
  );
}
