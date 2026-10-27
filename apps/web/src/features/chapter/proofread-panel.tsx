/**
 * Panel "AI hiệu đính" (rail công cụ): chạy hiệu đính cả chương (job chapter.proofread, model theo Cài đặt chung →
 * Pipeline), xem gợi ý theo trang (bản hiện tại → đề xuất + lý do), Nhận / Bỏ từng gợi ý, "Nhận tất cả" ở trang đang
 * mở. Nhận = sửa bản dịch như gõ tay (`setRegionTranslation` qua editorStore: undo/redo, autosave, version, khoá
 * chương, ngắt dòng lại box) — gợi ý không bao giờ tự ghi đè. Trạng thái gợi ý suy từ bản dịch hiện tại
 * (proofread-model.ts): khối bị sửa khác đi sau khi tạo gợi ý → "Lỗi thời".
 */

import type { PageState } from "@mtl/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Draft } from "immer";
import { useMemo, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { setRegionTranslation } from "../editor/actions.ts";
import { editorStore, useEditor } from "../editor/store.ts";
import { dismissSuggestion, fetchProofread, type JobView, proofreadKey, runProofread } from "./api.ts";
import { describeJobError, ERROR_CLASS } from "./job-error.ts";
import {
  STATE_LABEL,
  type Suggestion,
  type SuggestionState,
  sortSuggestions,
  suggestionState,
} from "./proofread-model.ts";
import type { Row } from "./text-table/rows.ts";

const ACTIVE = new Set(["queued", "running", "paused_budget"]);
/** Chương đã qua Bước 2 (khớp API enqueueProofread). */
const TRANSLATED = new Set(["review", "done", "partial_failed"]);

type Item = Suggestion & { row: Row | undefined; state: SuggestionState; pageNo: number | null };

const headId = (id: string) => `pf-head-${id}`;
/** Sau Nhận / Bỏ nút vừa bấm biến mất → focus về tiêu đề khối (không rơi về <body>). */
const focusHead = (id: string) => requestAnimationFrame(() => document.getElementById(headId(id))?.focus());

/** Câu báo trạng thái lượt hiệu đính cho người (lỗi thô của provider chỉ trong "Chi tiết kỹ thuật"). */
function jobNotice(job: JobView | null): { text: string; tone: "info" | "danger"; raw: string | null } | null {
  if (!job) return null;
  if (job.status === "paused_budget")
    return { text: "Tạm dừng vì vượt ngân sách AI — tự chạy tiếp khi ngân sách mở lại.", tone: "info", raw: null };
  const d = describeJobError(job);
  if (d?.waiting) return { text: d.text, tone: "info", raw: null };
  if (job.status === "failed")
    return {
      text: `Lần hiệu đính gần nhất lỗi: ${ERROR_CLASS[job.error_class ?? "internal"] ?? job.error_class}. Bấm "Hiệu đính lại cả chương" để chạy lại.`,
      tone: "danger",
      raw: job.error,
    };
  if (job.status === "cancelled") return { text: "Lần hiệu đính gần nhất đã huỷ.", tone: "info", raw: null };
  return null;
}

export function ProofreadPanel(props: {
  chapterId: string;
  status: string | undefined;
  rows: Row[];
  activeId: string | null;
  onPick(row: Row): Promise<void>;
  beforeRun(): Promise<unknown>;
}) {
  const { chapterId, rows, activeId } = props;
  const qc = useQueryClient();
  const readOnly = useEditor((s) => !!s.readOnly);
  const q = useQuery({
    queryKey: proofreadKey(chapterId),
    queryFn: () => fetchProofread(chapterId),
    refetchInterval: (query) => (query.state.data?.job && ACTIVE.has(query.state.data.job.status) ? 2500 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: proofreadKey(chapterId) });
  const run = useMutation({
    mutationFn: async () => {
      await props.beforeRun();
      return runProofread(chapterId);
    },
    onSettled: refresh,
  });
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
      setAcceptError(
        s.readOnly ? "Trang đang chỉ xem — chưa nhận được gợi ý." : "Chưa mở được trang của khối — thử lại.",
      );
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
          disabled={!canRun || run.isPending}
          title={TRANSLATED.has(props.status ?? "") ? undefined : "Dùng được khi chương đã dịch (sau Bước 2)"}
          onClick={() => run.mutate()}
        >
          {running ? "Đang hiệu đính…" : items.length || job ? "Hiệu đính lại cả chương" : "Chạy AI hiệu đính"}
        </button>
        {pendingHere.length > 0 && (
          <button type="button" disabled={readOnly} onClick={acceptAllHere}>
            Nhận tất cả ở trang này ({pendingHere.length})
          </button>
        )}
        <span className="muted small" role="status">
          {running ? "AI đang đọc bản dịch…" : items.length ? `${pendingTotal} gợi ý chờ duyệt / ${items.length}` : ""}
        </span>
        {running && job?.status === "running" && (
          <span className="muted small" aria-hidden="true">
            {Math.round(job.progress * 100)}%
          </span>
        )}
      </div>
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
              <summary>Chi tiết kỹ thuật</summary>
              <pre>{notice.raw}</pre>
            </details>
          )}
        </div>
      )}
      {!items.length && !running && !q.isError && (
        <p className="muted small cw-pad">
          {job?.status === "succeeded"
            ? "AI không thấy khối nào cần sửa (hoặc mọi gợi ý đã được bỏ)."
            : "AI đọc bản dịch cả chương (kèm ảnh trang, glossary, quy tắc xưng hô, giọng văn của series) và đề xuất sửa từng khối. Gợi ý không tự ghi đè bản dịch — bạn Nhận hoặc Bỏ từng cái. Model chọn ở Cài đặt chung → Pipeline."}
        </p>
      )}
      <ol className="cw-proofread-list" aria-label="Gợi ý hiệu đính">
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
              title="Mở khối này trên ảnh"
            >
              Trang {it.pageNo ?? "?"} · Khối {it.row?.index ?? "?"}
              <span
                className="status"
                data-tone={it.state === "pending" ? "warn" : it.state === "applied" ? "ok" : "idle"}
              >
                {STATE_LABEL[it.state]}
              </span>
            </button>
            <div className="cw-proofread-diff">
              <del>
                <span className="sr-only">Bản hiện tại: </span>
                {it.state === "stale" ? (it.row?.translation ?? it.old) : it.old}
              </del>
              <ins>
                <span className="sr-only">Đề xuất: </span>
                {it.suggestion}
              </ins>
            </div>
            {it.reason && <p className="muted small">{it.reason}</p>}
            <div className="row">
              {it.state === "pending" && (
                <button type="button" disabled={readOnly || !it.row?.regionId} onClick={() => void accept(it)}>
                  Nhận
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
                  Bỏ
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
