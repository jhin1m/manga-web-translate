/**
 * Panel "AI hiệu đính" (rail công cụ): chạy hiệu đính cả chương (job chapter.proofread, model theo Cài đặt admin →
 * Pipeline), xem gợi ý theo trang (bản hiện tại → đề xuất + lý do), Nhận / Bỏ từng gợi ý, "Nhận tất cả" ở trang đang
 * mở. Nhận = sửa bản dịch như gõ tay (`setRegionTranslation` qua editorStore: undo/redo, autosave, version, khoá
 * chương, ngắt dòng lại box) — gợi ý không bao giờ tự ghi đè. Trạng thái gợi ý suy từ bản dịch hiện tại
 * (proofread-model.ts): khối bị sửa khác đi sau khi tạo gợi ý → "Lỗi thời".
 */

import type { PageState } from "@mtl/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Draft } from "immer";
import { useEffect, useMemo, useRef, useState } from "react";
import { InfoTip } from "../../app/info-tip.tsx";
import { t, useT } from "../../i18n/t.ts";
import { errorMessage } from "../../lib/api.ts";
import { setRegionTranslation } from "../editor/actions.ts";
import { editorStore, useEditor } from "../editor/store.ts";
import {
  dismissSuggestion,
  fetchProofread,
  fetchProofreadEstimate,
  type JobView,
  proofreadKey,
  runProofread,
} from "./api.ts";
import { describeJobError, jobErrorLabel, needsTaskSetup } from "./job-error.ts";
import {
  estimateLines,
  estimateSummary,
  pendingCount,
  proofreadDataNotice,
  type Suggestion,
  type SuggestionState,
  sortSuggestions,
  stateLabel,
  suggestionState,
} from "./proofread-model.ts";
import type { Row } from "./text-table/rows.ts";

const ACTIVE = new Set(["queued", "running", "paused_budget"]);
/** Chương đã dịch (khớp API enqueueProofread). */
const TRANSLATED = new Set(["review", "done", "partial_failed"]);

type Item = Suggestion & { row: Row | undefined; state: SuggestionState; pageNo: number | null };

const headId = (id: string) => `pf-head-${id}`;
/** Sau Nhận / Bỏ nút vừa bấm biến mất → focus về tiêu đề khối (không rơi về <body>). */
const focusHead = (id: string) => requestAnimationFrame(() => document.getElementById(headId(id))?.focus());

/** Câu báo trạng thái lượt hiệu đính cho người (lỗi thô của provider chỉ trong "Chi tiết kỹ thuật"). */
function jobNotice(job: JobView | null): { text: string; tone: "info" | "danger"; raw: string | null } | null {
  if (!job) return null;
  if (job.status === "paused_budget")
    return { text: t("chapter.proofreadPanel.pausedBudget"), tone: "info", raw: null };
  const d = describeJobError(job);
  if (d?.waiting) return { text: d.text, tone: "info", raw: null };
  if (job.status === "failed" && needsTaskSetup(job) && d) return { text: d.text, tone: "danger", raw: null };
  if (job.status === "failed")
    return {
      text: t("chapter.proofreadPanel.lastFailed", { error: jobErrorLabel(job) }),
      tone: "danger",
      raw: job.error,
    };
  if (job.status === "cancelled") return { text: t("chapter.proofreadPanel.lastCancelled"), tone: "info", raw: null };
  return null;
}

/** Gợi ý + lượt hiệu đính của chương; poll khi lượt còn chạy. Panel và nhãn tab "Hiệu đính · N" dùng chung cache. */
export function useProofread(chapterId: string, enabled = true) {
  return useQuery({
    queryKey: proofreadKey(chapterId),
    queryFn: () => fetchProofread(chapterId),
    enabled,
    refetchInterval: (query) => (query.state.data?.job && ACTIVE.has(query.state.data.job.status) ? 2500 : false),
  });
}

/** Số gợi ý chờ duyệt của chương (nhãn tab "Hiệu đính · N"); theo bản dịch hiện tại của từng khối. */
export function usePendingProofread(chapterId: string, rows: Row[], enabled: boolean): number {
  const q = useProofread(chapterId, enabled);
  return useMemo(() => {
    const byKey = new Map(rows.map((r) => [r.key, r.translation]));
    return pendingCount(q.data?.suggestions ?? [], (k) => byKey.get(k));
  }, [q.data, rows]);
}

export function ProofreadPanel(props: {
  chapterId: string;
  status: string | undefined;
  rows: Row[];
  activeId: string | null;
  onPick(row: Row): Promise<void>;
  beforeRun(): Promise<unknown>;
  /** Tab đang hiện. Panel giữ mount khi chuyển tab; rời tab thì đóng hộp xác nhận (giá ước tính sẽ cũ khi quay lại). */
  active: boolean;
}) {
  const { chapterId, rows, activeId, active } = props;
  const { t } = useT();
  const qc = useQueryClient();
  const readOnly = useEditor((s) => !!s.readOnly);
  const q = useProofread(chapterId);
  const refresh = () => qc.invalidateQueries({ queryKey: proofreadKey(chapterId) });
  const run = useMutation({
    mutationFn: async () => {
      await props.beforeRun();
      return runProofread(chapterId);
    },
    onSettled: refresh,
  });
  // Bấm chạy → hỏi xác nhận kèm ước tính (giá, thời gian, dữ liệu gửi AI) rồi mới tạo job.
  const [confirming, setConfirming] = useState(false);
  const estimate = useQuery({
    queryKey: [...proofreadKey(chapterId), "estimate"],
    queryFn: () => fetchProofreadEstimate(chapterId),
    enabled: confirming,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (!active) setConfirming(false);
  }, [active]);
  const confirmRef = useRef<HTMLElement>(null);
  // Mở hộp: lấy ước tính mới (dữ liệu cũ không hiện lại) + đưa focus vào hộp cho người dùng bàn phím / screen reader.
  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
  }, [confirming]);
  const openConfirm = () => {
    qc.removeQueries({ queryKey: [...proofreadKey(chapterId), "estimate"] });
    setConfirming(true);
  };
  const dismiss = useMutation({ mutationFn: (id: string) => dismissSuggestion(id), onSettled: refresh });
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const items: Item[] = useMemo(() => {
    const rowIndex = new Map(rows.map((r) => [r.key, r.index]));
    const pageOrd = new Map(rows.map((r) => [r.pageId, r.ord]));
    return sortSuggestions(q.data?.suggestions ?? [], pageOrd, rowIndex).map((s) => {
      const row = byKey.get(`${s.page_id}:${s.region_id}`);
      const ord = pageOrd.get(s.page_id);
      const pageNo = ord === undefined ? null : ord + 1;
      return { ...s, row, state: suggestionState(s, row?.translation), pageNo };
    });
  }, [q.data, rows, byKey]);

  const job = q.data?.job ?? null;
  const running = !!job && ACTIVE.has(job.status);
  // Chỉ xem (tab khác giữ khoá…) → không chạy lại / bỏ: lượt mới thay toàn bộ gợi ý (cả lượt Bỏ) của chương.
  const canRun = TRANSLATED.has(props.status ?? "") && !running && !readOnly;
  const notice = running && job?.status === "running" ? null : jobNotice(job);
  const pendingHere = items.filter((it) => it.page_id === activeId && it.state === "pending" && it.row?.regionId);
  const pendingTotal = items.filter((it) => it.state === "pending").length;

  /** Nhận 1 gợi ý: mở trang của khối (lưu trang cũ trước) rồi sửa bản dịch như gõ tay. */
  const accept = async (it: Item) => {
    if (!it.row?.regionId) return;
    setAcceptError(null);
    await props.onPick(it.row);
    const s = editorStore.getState();
    if (s.pageId !== it.page_id || !s.layout || s.readOnly) {
      setAcceptError(s.readOnly ? t("chapter.proofreadPanel.readOnlyAccept") : t("chapter.proofreadPanel.pageNotOpen"));
      return;
    }
    s.apply(setRegionTranslation(it.row.regionId, it.suggestion, s.layout));
    focusHead(it.id);
  };
  /** Nhận mọi gợi ý chờ duyệt của trang đang mở — 1 bước hoàn tác. */
  const acceptAllHere = () => {
    const s = editorStore.getState();
    const layout = s.layout;
    if (!layout || s.readOnly || s.pageId !== activeId) return;
    s.apply((d: Draft<PageState>) => {
      for (const it of pendingHere)
        if (it.row?.regionId) setRegionTranslation(it.row.regionId, it.suggestion, layout)(d);
    });
  };

  return (
    <div className="cw-proofread">
      <div className="cw-panel-tools">
        <button
          type="button"
          className={items.length ? undefined : "btn-primary"}
          disabled={!canRun || run.isPending || confirming}
          title={TRANSLATED.has(props.status ?? "") ? undefined : t("chapter.proofreadPanel.needsTranslated")}
          onClick={openConfirm}
        >
          {running
            ? t("chapter.proofreadPanel.running")
            : items.length || job
              ? t("chapter.proofreadPanel.rerun")
              : t("chapter.proofreadPanel.run")}
        </button>
        {pendingHere.length > 0 && (
          <button type="button" disabled={readOnly} onClick={acceptAllHere}>
            {t("chapter.proofreadPanel.acceptAllHere", { count: pendingHere.length })}
          </button>
        )}
        <span className="muted small" role="status">
          {running
            ? t("chapter.proofreadPanel.aiReading")
            : items.length
              ? t("chapter.proofreadPanel.pendingOf", { pending: pendingTotal, total: items.length })
              : ""}
        </span>
        {running && job?.status === "running" && (
          <span className="muted small" aria-hidden="true">
            {Math.round(job.progress * 100)}%
          </span>
        )}
      </div>
      {confirming && (
        <section
          ref={confirmRef}
          tabIndex={-1}
          className="notice info cw-pad cw-proofread-confirm"
          aria-label={t("chapter.proofreadPanel.confirmLabel")}
        >
          {estimate.isPending ? (
            <p className="muted small">{t("chapter.proofreadPanel.estimating")}</p>
          ) : estimate.isError ? (
            <p className="small">
              {t("chapter.proofreadPanel.estimateFailed", { error: errorMessage(estimate.error) })}
            </p>
          ) : (
            <p className="small" title={estimateLines(estimate.data).join("\n")}>
              {estimateSummary(estimate.data)}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn-primary"
              disabled={!canRun || run.isPending || estimate.isPending || estimate.data?.pages === 0}
              onClick={() => {
                setConfirming(false);
                run.mutate();
              }}
            >
              {t("chapter.proofreadPanel.runConfirm")}
            </button>
            <InfoTip label={t("chapter.proofreadPanel.dataTip")}>{proofreadDataNotice()}</InfoTip>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </section>
      )}
      {[run.error, dismiss.error, q.error].filter(Boolean).map((e) => (
        <p key={String(e)} className="notice danger cw-pad" role="alert">
          {errorMessage(e)}
        </p>
      ))}
      {acceptError && (
        <p className="notice danger cw-pad" role="alert">
          {acceptError}
        </p>
      )}
      {notice && (
        <div className={`notice cw-pad ${notice.tone}`}>
          {notice.text}
          {notice.raw && (
            <details className="cw-error-raw">
              <summary>{t("chapter.proofreadPanel.techDetails")}</summary>
              <pre>{notice.raw}</pre>
            </details>
          )}
        </div>
      )}
      {!items.length && !running && !q.isError && job?.status === "succeeded" && (
        <p className="muted small cw-pad">{t("chapter.proofreadPanel.nothingToFix")}</p>
      )}
      <ol className="cw-proofread-list" aria-label={t("chapter.proofreadPanel.listLabel")}>
        {items.map((it) => (
          <li
            key={it.id}
            className="cw-proofread-item"
            data-state={it.state}
            data-active={it.page_id === activeId || undefined}
          >
            <button
              type="button"
              id={headId(it.id)}
              className="cw-proofread-head btn-ghost"
              disabled={!it.row}
              onClick={() => it.row && void props.onPick(it.row)}
              title={t("chapter.proofreadPanel.openBlock")}
            >
              {t("chapter.proofreadPanel.itemHead", { page: it.pageNo ?? "?", block: it.row?.index ?? "?" })}
              <span
                className="status"
                data-tone={it.state === "pending" ? "warn" : it.state === "applied" ? "ok" : "idle"}
              >
                {stateLabel(it.state)}
              </span>
            </button>
            <div className="cw-proofread-diff">
              <del>
                <span className="sr-only">{t("chapter.proofreadPanel.current")}</span>
                {it.state === "stale" ? (it.row?.translation ?? it.old) : it.old}
              </del>
              <ins>
                <span className="sr-only">{t("chapter.proofreadPanel.suggested")}</span>
                {it.suggestion}
              </ins>
            </div>
            {it.reason && <p className="muted small">{it.reason}</p>}
            <div className="row">
              {it.state === "pending" && (
                <button type="button" disabled={readOnly || !it.row?.regionId} onClick={() => void accept(it)}>
                  {t("chapter.proofreadPanel.accept")}
                </button>
              )}
              {it.state !== "applied" && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={dismiss.isPending || readOnly}
                  onClick={() => {
                    const i = items.indexOf(it);
                    const next = items[i + 1] ?? items[i - 1];
                    dismiss.mutate(it.id, { onSuccess: () => next && focusHead(next.id) });
                  }}
                >
                  {t("chapter.proofreadPanel.dismiss")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
