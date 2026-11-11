/**
 * Gợi ý xưng hô AI học được, trong nhóm Xưng hô của Cài đặt dịch. Nhận chỉ thêm hàng vào bảng của form (chưa gọi
 * server — bấm Lưu mới áp dụng); Bỏ gọi server để không gợi ý lại.
 */
import { pronounKey } from "@mtl/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { InfoTip } from "../../app/info-tip.tsx";
import { errorMessage } from "../../lib/api.ts";
import { dismissSuggestion, type PronounRule, type PronounSuggestion, seriesKeys } from "./api.ts";
import { focusAfterRemoval, hasAcceptedRule, neighborId } from "./suggestions.ts";

export function PronounSuggestions(props: {
  seriesId: string;
  items: PronounSuggestion[];
  /** Bảng quy tắc đang sửa trong form — để biết hàng vừa Nhận còn đó (chưa Lưu) hay đã bị xoá. */
  rules: readonly PronounRule[];
  onAccept: (s: PronounSuggestion) => void;
}) {
  const { seriesId, items } = props;
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLElement>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const added = hasAcceptedRule(accepted, props.rules);
  // Giữ nút khoá tới khi danh sách gợi ý tải lại xong (mutation pending tới lúc đó).
  const dismiss = useMutation({
    mutationFn: (s: PronounSuggestion) => dismissSuggestion(s.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: seriesKeys.suggestions(seriesId) }),
  });

  if (items.length === 0 && !added) return null;

  const accept = (s: PronounSuggestion) => {
    const section = sectionRef.current;
    setAccepted((cur) => new Set(cur).add(pronounKey(s.speaker, s.listener)));
    props.onAccept(s);
    // Hàng quy tắc mới nằm cuối bảng: đưa focus vào ô "Xưng / gọi" của nó.
    requestAnimationFrame(() => {
      const inputs = section?.closest("details")?.querySelectorAll<HTMLElement>('input[aria-label="Xưng / gọi"]');
      inputs?.[inputs.length - 1]?.focus();
    });
  };
  const remove = (s: PronounSuggestion) => {
    const section = sectionRef.current;
    const nextId = neighborId(
      items.map((i) => i.id),
      s.id,
    );
    const fallback = section?.closest("details")?.querySelector<HTMLElement>("summary") ?? null;
    dismiss.mutate(s, { onSuccess: () => focusAfterRemoval(section, nextId, "dismiss", fallback) });
  };

  return (
    <section ref={sectionRef} className="ai-suggestions" aria-label="Gợi ý xưng hô từ AI">
      {items.length > 0 && (
        <>
          <div className="field-head">
            <span className="ai-suggestions-title">Gợi ý từ AI · {items.length}</span>
            <InfoTip label="Giải thích Gợi ý xưng hô">
              AI ghi lại cách các nhân vật xưng hô khi dịch. Nhận = thêm vào bảng (bấm Lưu để áp dụng). Bỏ = không gợi ý
              lại.
            </InfoTip>
          </div>
          {dismiss.error && (
            <p className="small error" role="status">
              {errorMessage(dismiss.error)}
            </p>
          )}
          <table className="data">
            <tbody>
              {items.map((s) => (
                <tr key={s.id} data-suggestion={s.id}>
                  <td>
                    {s.speaker} → {s.listener}: {s.address}
                  </td>
                  <td className="muted small">{s.chapter_number ? `Ch.${s.chapter_number}` : ""}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={dismiss.isPending}
                      aria-label={`Nhận ${s.speaker} → ${s.listener}`}
                      onClick={() => accept(s)}
                    >
                      Nhận
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={dismiss.isPending}
                      aria-label={`Bỏ ${s.speaker} → ${s.listener}`}
                      data-act="dismiss"
                      onClick={() => remove(s)}
                    >
                      Bỏ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {added && <p className="small muted">Đã thêm vào bảng — bấm Lưu để áp dụng.</p>}
    </section>
  );
}
