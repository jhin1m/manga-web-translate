/**
 * Áp glossary (đoạn "Glossary" của panel Tìm màn chương) — áp lại glossary vào bản dịch có sẵn (không gọi LLM): mỗi
 * entry của glossary series có ô "cụm cũ trong bản dịch" (mặc định = từ gốc để bắt chữ chưa dịch). Chọn entry → xem
 * trước → áp dụng → hoàn tác.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { applyGlossaryRules, type GlossaryRule, previewGlossaryApply } from "../chapter/api.ts";
import { FlowPanel, type ToolPanelProps, useBatchFlow } from "../chapter/FindReplace.tsx";
import { LockBanner } from "../chapter/lock-banner.tsx";
import { fetchGlossary, type GlossaryEntry, glossaryKey } from "./api.ts";

const NO_ENTRIES: GlossaryEntry[] = [];

export function ApplyGlossaryPanel(props: ToolPanelProps) {
  const { seriesId, chapterId, lock, beforeWrite, onJump, batch } = props;
  const { t, tNode } = useT();
  const scope = { seriesId };
  const q = useQuery({ queryKey: glossaryKey(scope), queryFn: () => fetchGlossary(scope) });
  const entries = q.data?.entries ?? NO_ENTRIES;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState<Record<string, string>>({});

  const rules: GlossaryRule[] = entries
    .filter((e) => picked.has(e.id))
    .map((e) => ({ source_term: e.source_term, from: (from[e.id] ?? e.source_term).trim() || e.source_term }));
  // Chỉ số rule trong request → entry, để highlight đúng cụm cũ/mới của từng khớp.
  const picks = entries.filter((e) => picked.has(e.id));

  const flow = useBatchFlow(
    { chapterId },
    {
      input: rules,
      beforeWrite,
      preview: (r) => previewGlossaryApply(chapterId, r),
      apply: (r, versions) => applyGlossaryRules(chapterId, r, versions),
      hooks: batch,
    },
  );
  const [used, setUsed] = useState<{ from: string; to: string }[]>([]);
  const touch = () => flow.invalidate();

  return (
    <div className="cw-tool">
      <LockBanner state={lock.state} onRetry={() => void lock.retry()} />
      <p className="muted small" style={{ marginTop: 0 }}>
        {tNode("glossary.apply.intro", {
          link: (
            <Link to="/s/$seriesId" params={{ seriesId }} search={{ tab: "glossary" }}>
              {t("glossary.apply.editLink")}
            </Link>
          ),
        })}
      </p>
      {q.isError && <p className="notice danger">{errorMessage(q.error)}</p>}
      {q.isLoading && <p className="muted small">{t("glossary.apply.loading")}</p>}
      {q.data && entries.length === 0 && <p className="muted">{t("glossary.apply.empty")}</p>}
      {entries.length > 0 && (
        <div className="cw-tool-list">
          <table className="data">
            <thead>
              <tr>
                <th />
                <th>{t("glossary.apply.colSource")}</th>
                <th>{t("glossary.apply.colTarget")}</th>
                <th>{t("glossary.apply.colOld")}</th>
                <th>{t("glossary.apply.colScope")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t("glossary.apply.pickAria", { term: e.source_term })}
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
                      aria-label={t("glossary.apply.oldAria", { term: e.source_term })}
                      value={from[e.id] ?? e.source_term}
                      maxLength={200}
                      onChange={(ev) => {
                        setFrom({ ...from, [e.id]: ev.target.value });
                        touch();
                      }}
                    />
                  </td>
                  <td className="small muted">
                    {e.series_id ? t("glossary.apply.scopeSeries") : t("glossary.apply.scopeGlobal")}
                  </td>
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
