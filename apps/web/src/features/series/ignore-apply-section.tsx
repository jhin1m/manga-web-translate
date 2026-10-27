/**
 * Cài đặt series, dưới ô "Chữ bỏ qua": ẩn box khớp danh sách đã lưu trong các chương đã dịch. Bắt buộc xem trước
 * (theo chương: số box + vài mẫu chữ nguồn; chương đang có người sửa / đang chạy job bị bỏ qua) rồi mới áp dụng; sau
 * áp có "Hoàn tác" theo batch_id (trang đã đổi sau đó được bỏ qua và báo lại). Không xoá box, không đổi bản dịch.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import {
  applyIgnoreApply,
  type IgnoreApplied,
  type IgnorePreview,
  previewIgnoreApply,
  undoIgnoreApply,
} from "./api.ts";
import { appliedSummary, describeSkipped, previewSummary, undoneSummary } from "./ignore-apply-model.ts";

type Notice = { tone: "info" | "danger"; text: string; skipped?: string; undo?: string };

export function IgnoreApplySection({ seriesId, disabledReason }: { seriesId: string; disabledReason: string | null }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<IgnorePreview | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Chương đổi trạng thái (cần xuất lại) và state trang đổi → làm mới màn chương + danh sách.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["series"] });
    void qc.invalidateQueries({ queryKey: ["chapter"] });
  };
  const fail = (e: unknown) => setNotice({ tone: "danger", text: errorMessage(e) });

  const previewM = useMutation({
    mutationFn: () => previewIgnoreApply(seriesId),
    onSuccess: (p) => {
      setNotice(null);
      setPreview(p);
    },
    onError: fail,
  });
  const applyM = useMutation({
    mutationFn: (p: IgnorePreview) =>
      applyIgnoreApply(seriesId, Object.assign({}, ...p.chapters.map((c) => c.versions))),
    onSuccess: (r: IgnoreApplied) => {
      setPreview(null);
      setNotice({
        tone: "info",
        text: appliedSummary(r),
        skipped: describeSkipped(r.skipped),
        undo: r.batch_id ?? undefined,
      });
      refresh();
    },
    onError: fail,
  });
  const undoM = useMutation({
    mutationFn: (batchId: string) => undoIgnoreApply(seriesId, batchId),
    onSuccess: (r) => {
      setNotice({ tone: "info", text: undoneSummary(r), skipped: describeSkipped(r.skipped) });
      refresh();
    },
    onError: fail,
  });
  const busy = previewM.isPending || applyM.isPending || undoM.isPending;

  return (
    <section className="ignore-apply" aria-label="Ẩn chữ khớp trong chương đã dịch">
      <div className="row">
        <button type="button" disabled={busy || !!disabledReason} onClick={() => previewM.mutate()}>
          Ẩn chữ khớp trong chương đã dịch…
        </button>
        {disabledReason && <span className="hint">{disabledReason}</span>}
      </div>
      {preview && (
        <div className="ignore-apply-preview">
          <p className="small" style={{ margin: "4px 0" }}>
            {previewSummary(preview)}
          </p>
          {preview.chapters.length > 0 && (
            <ul className="small" style={{ margin: "0 0 4px", paddingLeft: 18 }}>
              {preview.chapters.map((c) => (
                <li key={c.chapter_id}>
                  <strong>Chương {c.number}</strong>: {c.boxes} box
                  {c.samples.length > 0 && (
                    <span className="muted"> · {c.samples.map((s) => `“${s}”`).join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {preview.skipped.length > 0 && (
            <p className="small muted" style={{ margin: "0 0 4px" }}>
              Bỏ qua: {describeSkipped(preview.skipped)}.
            </p>
          )}
          <div className="row">
            {preview.total_boxes > 0 && (
              <button type="button" disabled={busy} onClick={() => applyM.mutate(preview)}>
                Ẩn {preview.total_boxes} box
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setPreview(null)}>
              Huỷ
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className={notice.tone === "danger" ? "small error" : "small"} style={{ margin: "4px 0 0" }}>
          {notice.text}
          {notice.undo && (
            <>
              {" · "}
              <button type="button" disabled={busy} onClick={() => undoM.mutate(notice.undo as string)}>
                Hoàn tác
              </button>
            </>
          )}
          {notice.skipped ? <span className="muted"> Bỏ qua: {notice.skipped}.</span> : null}
        </p>
      )}
    </section>
  );
}
