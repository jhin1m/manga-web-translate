/**
 * Gợi ý thuật ngữ AI học được khi dịch, đặt đầu modal Glossary của series. Nhận = thêm vào glossary series
 * (lần dịch sau dùng), Bỏ = không gợi ý lại. Không có gợi ý thì không hiện gì.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { InfoTip } from "../../app/info-tip.tsx";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { dismissSuggestion, fetchSuggestions, seriesKeys, type TermSuggestion } from "../series/api.ts";
import { focusAfterRemoval, neighborId, TERM_KIND_LABEL } from "../series/suggestions.ts";
import { createEntry } from "./api.ts";

const isDuplicate = (e: unknown) => e instanceof ApiError && e.status === 409 && e.body.error === "duplicate_term";

export function GlossarySuggestions({ seriesId }: { seriesId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: seriesKeys.suggestions(seriesId), queryFn: () => fetchSuggestions(seriesId) });
  const sectionRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  // Hàng chỉ gỡ khi danh sách gợi ý đã tải lại: mutation còn "pending" tới lúc đó nên nút vẫn bị khoá.
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["glossary"] }), qc.invalidateQueries({ queryKey: ["series"] })]);
  const accept = useMutation({
    mutationFn: (s: TermSuggestion) =>
      createEntry({ seriesId }, { source_term: s.source, target_term: s.target, note: "", case_sensitive: false }),
    onSuccess: async () => {
      setMessage(null);
      await refresh();
    },
    onError: async (e, s) => {
      // Từ đã có trong glossary: không phải lỗi, làm mới để dòng gợi ý tự biến mất.
      if (isDuplicate(e)) {
        setMessage({ text: `“${s.source}” đã có trong glossary.`, tone: "info" });
        await refresh();
      } else setMessage({ text: errorMessage(e), tone: "error" });
    },
  });
  const dismiss = useMutation({
    mutationFn: (s: TermSuggestion) => dismissSuggestion(s.id),
    onSuccess: async () => {
      setMessage(null);
      await qc.invalidateQueries({ queryKey: seriesKeys.suggestions(seriesId) });
    },
    onError: (e) => setMessage({ text: errorMessage(e), tone: "error" }),
  });

  const terms = q.data?.terms ?? [];
  if (terms.length === 0) return null;
  // Chạy lúc bấm (trước khi hàng biến mất): chọn đích focus, hết hàng thì về ô nhập đầu của glossary bên dưới.
  const act = (s: TermSuggestion, kind: "accept" | "dismiss") => {
    const section = sectionRef.current;
    const nextId = neighborId(
      terms.map((t) => t.id),
      s.id,
    );
    const fallback = section?.closest<HTMLElement>('[role="dialog"]')?.querySelector<HTMLElement>("input, textarea");
    const focus = () => focusAfterRemoval(section, nextId, kind, fallback ?? null);
    // Từ trùng cũng làm hàng biến mất nên cũng trả focus.
    const done = { onSuccess: focus, onError: (e: unknown) => isDuplicate(e) && focus() };
    if (kind === "accept") accept.mutate(s, done);
    else dismiss.mutate(s, done);
  };
  // Khoá mọi hàng khi một thao tác còn chạy: tránh hai thao tác chồng nhau và chọn nhầm đích focus.
  const busy = accept.isPending || dismiss.isPending;

  return (
    <section ref={sectionRef} className="ai-suggestions" aria-label="Gợi ý từ AI">
      <div className="field-head">
        <span className="ai-suggestions-title">Gợi ý từ AI · {terms.length}</span>
        <InfoTip label="Giải thích Gợi ý từ AI">
          AI ghi lại tên riêng / thuật ngữ mới gặp khi dịch. Nhận = thêm vào glossary series, lần dịch sau dùng. Bỏ =
          không gợi ý lại.
        </InfoTip>
      </div>
      {message && (
        <p className={message.tone === "error" ? "small error" : "small muted"} role="status">
          {message.text}
        </p>
      )}
      <table className="data">
        <tbody>
          {terms.map((s) => (
            <tr key={s.id} data-suggestion={s.id}>
              <td className="ai-src">{s.source}</td>
              <td>{s.target}</td>
              <td className="muted small">
                {TERM_KIND_LABEL[s.kind]}
                {s.chapter_number ? ` · Ch.${s.chapter_number}` : ""}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  aria-label={`Nhận ${s.source}`}
                  data-act="accept"
                  onClick={() => act(s, "accept")}
                >
                  Nhận
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  aria-label={`Bỏ ${s.source}`}
                  data-act="dismiss"
                  onClick={() => act(s, "dismiss")}
                >
                  Bỏ
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
