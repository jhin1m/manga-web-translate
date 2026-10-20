/**
 * Tiến độ upload của 1 chương (từ upload-manager) + tải tiếp khi tab cũ đóng giữa chừng / file lỗi.
 * Không có upload nào (phiên này lẫn dấu localStorage) → không hiện gì.
 */
import { fmtBytes } from "../../lib/format.ts";
import { fetchChapter } from "../chapter/api.ts";
import { FilePickButton } from "./drop-zone.tsx";
import { collectPages } from "./files.ts";
import { uploadManager, useChapterUpload } from "./upload-manager.ts";

/** Thả lại file của chương nháp → khớp với source_files → upload phần thiếu (ném lỗi nếu bộ file không khớp). */
export async function resumeFromFiles(ws: string, chapterId: string, files: File[]) {
  const [pages, chapter] = await Promise.all([collectPages(files), fetchChapter(ws, chapterId)]);
  if (chapter.status !== "draft") throw new Error("Chương đã dịch — không tải thêm ảnh được.");
  return uploadManager.resumeChapter({ ws, chapter, pages });
}

export function ChapterUploadStatus(props: {
  ws: string;
  chapterId: string;
  onResume: (files: File[]) => void;
  resumeError?: string | null;
}) {
  const u = useChapterUpload(props.chapterId);
  const view = uploadManager.view(props.chapterId, u);
  if (!view) return null;
  const pct = u ? (100 * u.bytesDone) / Math.max(u.bytesTotal, 1) : (100 * view.done) / Math.max(view.total, 1);

  return (
    <div className="upload-status" role="status" aria-label="Tiến độ tải ảnh">
      {view.phase === "uploading" && (
        <span className="status" data-tone="busy">
          Đang tải ảnh {view.done}/{view.total}
          {u ? ` · ${fmtBytes(u.bytesDone)}/${fmtBytes(u.bytesTotal)}` : ""}
        </span>
      )}
      {view.phase === "uploaded" && (
        <span className="status" data-tone="ok">
          Đã tải xong {view.total} ảnh
        </span>
      )}
      {view.phase === "failed" && (
        <>
          <span className="status" data-tone="danger">
            {view.total - view.done} ảnh tải lỗi · đã tải {view.done}/{view.total}
          </span>
          <button type="button" onClick={() => uploadManager.retryFailed(props.chapterId)}>
            Thử lại ảnh lỗi
          </button>
        </>
      )}
      {view.phase === "incomplete" && (
        <>
          <span className="status" data-tone="warn">
            Upload dở: đã tải {view.done}/{view.total} ảnh — chọn lại đúng bộ file để tải tiếp
          </span>
          <FilePickButton onFiles={props.onResume}>Tải tiếp ảnh…</FilePickButton>
        </>
      )}
      {view.phase !== "uploaded" && (
        <div className="bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {props.resumeError && <span className="small error">{props.resumeError}</span>}
      {u?.errors.slice(0, 3).map((e) => (
        <span key={e.name} className="small error mono">
          {e.name}: {e.error}
        </span>
      ))}
    </div>
  );
}
