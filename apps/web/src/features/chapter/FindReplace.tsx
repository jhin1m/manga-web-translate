/**
 * Tìm & thay trong chương (đoạn "Tìm / Thay" của panel Tìm màn chương): bắt buộc "Xem trước" (danh sách khớp) rồi
 * mới "Áp dụng" (gửi versions của lần xem trước để server từ chối nếu page đã đổi); sau áp có "Hoàn tác" theo batch_id. Ghi nội
 * dung cần khoá chương — dùng khoá của phiên. Trước mỗi lượt gọi server: lưu phần đang sửa (`beforeWrite`); sau ghi:
 * tải lại state chương (page đang sửa nạp lại nếu chưa sửa gì). Bấm 1 kết quả → nhảy tới khối đó.
 * Cũng export `useBatchFlow` + `MatchList` + `FlowPanel` để đoạn "Glossary" dùng lại cùng luồng.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { t, tp, useT } from "../../i18n/t.ts";
import { ApiError, errorMessage } from "../../lib/api.ts";
import {
  type ApplyResult,
  applyFindReplace,
  type FindMatch,
  type PreviewResult,
  previewFindReplace,
  undoBatch,
} from "./api.ts";
import { LockBanner } from "./lock-banner.tsx";
import { describeWriteError, splitHighlight } from "./text-utils.ts";
import type { LockState } from "./use-chapter-lock.ts";

type Ids = { seriesId: string; chapterId: string };

const writeError = (e: unknown) => {
  if (e instanceof ApiError) {
    const code = typeof e.body.error === "string" ? e.body.error : undefined;
    return { text: describeWriteError(e.status, code, errorMessage(e)), stale: code === "preview_stale" };
  }
  return { text: errorMessage(e), stale: false };
};

/**
 * Luồng xem trước → áp dụng → hoàn tác dùng chung find/replace và áp glossary. Áp dụng gửi ĐÚNG input đã xem trước
 * (chụp lúc bấm Xem trước), và kết quả xem trước về muộn sau khi input đã đổi bị bỏ — không bao giờ áp thứ chưa xem.
 */
/** Nối lượt sửa của panel với lịch sử undo của editor (Cmd+Z hoàn tác lượt gần nhất). */
export type BatchHooks = {
  /** Xin khoá hoàn tác chung (false = đang có yêu cầu hoàn tác khác bay); gọi `end` khi xong. */
  begin(): boolean;
  end(): void;
  /** Đang có yêu cầu hoàn tác (của panel, toast hay Cmd+Z) → tắt nút Hoàn tác. */
  busy: boolean;
  /** Server vừa áp lượt, trước khi tải lại state chương. */
  applied(r: ApplyResult): void;
  /** Nút Hoàn tác của panel vừa hoàn tác xong lượt. */
  undone(batchId: string, r: { pages: number; skipped: string[] }): void;
  /** Lượt vừa hoàn tác từ ngoài panel (Cmd+Z): panel bỏ trạng thái "đã áp dụng" để nút Hoàn tác không còn treo. */
  lastUndone: string | null;
};

export function useBatchFlow<I>(
  ids: Pick<Ids, "chapterId">,
  fns: {
    input: I;
    /** Chạy trước mỗi lượt gọi server (lưu phần đang sửa để server thấy bản mới nhất). */
    beforeWrite?(): Promise<unknown>;
    preview(input: I): Promise<PreviewResult>;
    apply(input: I, versions: Record<string, number>): Promise<ApplyResult>;
    hooks?: BatchHooks;
  },
) {
  const { chapterId } = ids;
  const qc = useQueryClient();
  const [preview, setPreview] = useState<{ result: PreviewResult; input: I } | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  /** Tăng mỗi lần input đổi/xem trước mới — response mang số cũ thì bỏ. */
  const gen = useRef(0);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["chapter", chapterId] });

  const previewM = useMutation({
    mutationFn: async (v: { input: I; gen: number }) => {
      await fns.beforeWrite?.();
      return { ...v, result: await fns.preview(v.input) };
    },
    onSuccess: ({ input, gen: g, result }) => {
      if (g !== gen.current) return;
      setPreview({ result, input });
      setApplied(null);
      setMessage(result.total === 0 ? { tone: "info", text: t("chapter.findReplace.noMatch") } : null);
    },
    onError: (e, v) => {
      if (v.gen === gen.current) setMessage({ tone: "danger", text: writeError(e).text });
    },
  });
  const applyM = useMutation({
    mutationFn: async (v: { input: I; versions: Record<string, number> }) => {
      await fns.beforeWrite?.();
      return fns.apply(v.input, v.versions);
    },
    onSuccess: (r) => {
      setApplied(r);
      setMessage({
        tone: "info",
        text: t("chapter.findReplace.replaced", {
          matches: tp("chapter.findReplace.matchCount", r.replaced),
          pages: tp("common.pages", r.pages),
        }),
      });
      fns.hooks?.applied(r);
      refresh();
    },
    onError: (e) => {
      const w = writeError(e);
      if (w.stale) setPreview(null);
      setMessage({ tone: "danger", text: w.text });
    },
  });
  const undoM = useMutation({
    onSettled: () => fns.hooks?.end(),
    mutationFn: async (batchId: string) => {
      await fns.beforeWrite?.();
      return undoBatch(chapterId, batchId);
    },
    onSuccess: (r, batchId) => {
      setApplied(null);
      setPreview(null);
      setMessage({ tone: "info", text: t("chapter.findReplace.undone", { pages: tp("common.pages", r.pages) }) });
      fns.hooks?.undone(batchId, r);
      refresh();
    },
    onError: (e) => setMessage({ tone: "danger", text: writeError(e).text }),
  });

  const lastUndone = fns.hooks?.lastUndone ?? null;
  const appliedBatch = applied?.batch_id;
  useEffect(() => {
    if (lastUndone && lastUndone === appliedBatch) {
      setApplied(null);
      setPreview(null);
      setMessage(null);
    }
  }, [lastUndone, appliedBatch]);

  return {
    preview: preview?.result ?? null,
    /** Input của lần xem trước đang hiển thị (để highlight đúng cụm đã dùng). */
    previewInput: preview?.input ?? null,
    applied,
    message,
    busy: previewM.isPending || applyM.isPending || undoM.isPending || !!fns.hooks?.busy,
    runPreview: () => previewM.mutate({ input: fns.input, gen: ++gen.current }),
    runApply: () => preview && applyM.mutate({ input: preview.input, versions: preview.result.versions }),
    runUndo: () => {
      if (!applied || (fns.hooks && !fns.hooks.begin())) return;
      undoM.mutate(applied.batch_id);
    },
    /** Input đổi sau khi xem trước → bản xem trước cũ (kể cả đang chờ) không còn đáng tin. */
    invalidate: () => {
      gen.current++;
      setPreview(null);
      setMessage(null);
    },
  };
}

export type BatchFlow = ReturnType<typeof useBatchFlow<unknown>>;

/** Nút Xem trước/Áp dụng/Hoàn tác + thông báo + danh sách khớp. */
export function FlowPanel({
  onJump,
  flow,
  lock,
  canPreview,
  highlight,
  showRule,
}: {
  onJump(m: FindMatch): void;
  flow: BatchFlow;
  lock: LockState;
  canPreview: boolean;
  highlight(m: FindMatch): { before: string; after: string; caseSensitive: boolean };
  showRule?: boolean;
}) {
  const { t, tp } = useT();
  const held = lock.status === "held";
  const { preview, applied } = flow;
  return (
    <>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" disabled={!canPreview || flow.busy} onClick={flow.runPreview}>
          {t("chapter.findReplace.preview")}
        </button>
        <button
          type="button"
          className="btn-primary"
          // Bản xem trước đã áp rồi thì phải xem trước lại (server cũng từ chối `preview_stale`).
          disabled={!preview || preview.total === 0 || !!applied || !held || flow.busy}
          title={
            held ? (applied ? t("chapter.findReplace.appliedTitle") : undefined) : t("chapter.findReplace.needLock")
          }
          onClick={flow.runApply}
        >
          {t("chapter.findReplace.apply")}
        </button>
        {applied && (
          <button type="button" className="btn-danger" disabled={!held || flow.busy} onClick={flow.runUndo}>
            {t("chapter.findReplace.undo")}
          </button>
        )}
      </div>
      {flow.message && (
        <p className={`notice ${flow.message.tone}`} role={flow.message.tone === "danger" ? "alert" : "status"}>
          {flow.message.text}
        </p>
      )}
      {preview && preview.total > 0 && (
        <>
          <p className="muted small">
            {tp("chapter.findReplace.totalMatches", preview.total)}
            {preview.truncated ? t("chapter.findReplace.truncated", { shown: preview.matches.length }) : ""}
            {applied ? t("chapter.findReplace.appliedSuffix") : ""}
          </p>
          <MatchList onJump={onJump} matches={preview.matches} highlight={highlight} showRule={showRule} />
        </>
      )}
    </>
  );
}

function Marked({ text, needle, cs, cls }: { text: string; needle: string; cs: boolean; cls?: string }) {
  let at = 0; // khoá theo vị trí ký tự của đoạn trong chuỗi
  return (
    <>
      {splitHighlight(text, needle, cs).map((p) => {
        const key = at;
        at += p.text.length;
        return p.hit ? (
          <mark key={key} className={`hit ${cls ?? ""}`}>
            {p.text}
          </mark>
        ) : (
          <Fragment key={key}>{p.text}</Fragment>
        );
      })}
    </>
  );
}

export function MatchList({
  onJump,
  matches,
  highlight,
  showRule,
}: {
  onJump(m: FindMatch): void;
  matches: FindMatch[];
  highlight(m: FindMatch): { before: string; after: string; caseSensitive: boolean };
  showRule?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="cw-tool-list">
      <table className="data">
        <thead>
          <tr>
            <th className="num">{t("chapter.findReplace.colPage")}</th>
            <th>{t("chapter.findReplace.colTarget")}</th>
            <th>{t("chapter.findReplace.colChange")}</th>
            <th className="num">{t("chapter.findReplace.colCount")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const h = highlight(m);
            return (
              <tr key={`${m.page_id}:${m.target}:${m.id}:${m.rule ?? ""}`}>
                <td className="num">{m.ord + 1}</td>
                <td className="small">
                  {m.target === "box" ? t("chapter.findReplace.targetBox") : t("chapter.findReplace.targetRegion")}
                  {showRule && m.rule != null ? t("chapter.findReplace.rule", { rule: m.rule + 1 }) : ""}
                  {m.target === "box" && showRule ? t("chapter.findReplace.boxReflow") : ""}
                </td>
                <td>
                  <div>
                    <Marked text={m.before} needle={h.before} cs={h.caseSensitive} />
                  </div>
                  <div className="muted">
                    → <Marked text={m.after} needle={h.after} cs={h.caseSensitive} cls="after" />
                  </div>
                </td>
                <td className="num">{m.count}</td>
                <td>
                  <button type="button" className="btn-ghost" onClick={() => onJump(m)}>
                    {t("chapter.findReplace.jump")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Khoá của phiên màn chương (panel KHÔNG tự lấy khoá: cleanup của hook khoá sẽ nhả khoá của phiên). */
export type SessionLock = { state: LockState; retry(): Promise<void> };

/** Props chung của tab Tìm/Thay và Áp glossary. */
export type ToolPanelProps = Ids & {
  lock: SessionLock;
  /** Lưu phần đang sửa trước khi gọi server. */
  beforeWrite(): Promise<unknown>;
  onJump(m: FindMatch): void;
  batch: BatchHooks;
};

export function FindReplacePanel({ chapterId, lock, beforeWrite, onJump, batch }: ToolPanelProps) {
  const { t } = useT();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [cs, setCs] = useState(false);
  const input = { find, replace, case_sensitive: cs };
  const flow = useBatchFlow(
    { chapterId },
    {
      input,
      beforeWrite,
      preview: (i) => previewFindReplace(chapterId, i),
      apply: (i, versions) => applyFindReplace(chapterId, i, versions),
      hooks: batch,
    },
  );
  // Highlight theo đúng cụm của lần xem trước đang hiển thị.
  const used = flow.previewInput ?? input;
  const edit = (fn: () => void) => {
    fn();
    flow.invalidate();
  };

  return (
    <div className="cw-tool">
      <LockBanner state={lock.state} onRetry={() => void lock.retry()} />
      <div className="cw-tool-form">
        <div>
          <label htmlFor="fr-find">{t("chapter.findReplace.find")}</label>
          <input id="fr-find" value={find} maxLength={200} onChange={(e) => edit(() => setFind(e.target.value))} />
        </div>
        <div>
          <label htmlFor="fr-replace">{t("chapter.findReplace.replaceWith")}</label>
          <input
            id="fr-replace"
            value={replace}
            maxLength={200}
            onChange={(e) => edit(() => setReplace(e.target.value))}
          />
        </div>
        <label className="row cw-tool-check">
          <input type="checkbox" checked={cs} onChange={(e) => edit(() => setCs(e.target.checked))} />
          {t("chapter.findReplace.caseSensitive")}
        </label>
      </div>
      <p className="muted small" style={{ margin: "4px 0 0" }}>
        {t("chapter.findReplace.hint")}
      </p>
      <FlowPanel
        onJump={onJump}
        flow={flow}
        lock={lock.state}
        canPreview={find.length > 0}
        highlight={() => ({ before: used.find, after: used.replace, caseSensitive: used.case_sensitive })}
      />
    </div>
  );
}
