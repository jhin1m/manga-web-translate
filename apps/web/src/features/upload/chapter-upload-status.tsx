/**
 * Tiến độ upload của 1 chương (từ upload-manager) + tải tiếp khi tab cũ đóng giữa chừng / file lỗi.
 * Không có upload nào (phiên này lẫn dấu localStorage) → không hiện gì.
 */
import { t, useT } from "../../i18n/t.ts";
import { fmtBytes } from "../../lib/format.ts";
import { fetchChapter } from "../chapter/api.ts";
import { FilePickButton } from "./drop-zone.tsx";
import { usableFiles } from "./dropped-paths.ts";
import { collectPages } from "./files.ts";
import { uploadManager, useChapterUpload } from "./upload-manager.ts";

/** Thả lại file của chương nháp → khớp với source_files → upload phần thiếu (ném lỗi nếu bộ file không khớp). */
export async function resumeFromFiles(chapterId: string, files: File[]) {
  const [pages, chapter] = await Promise.all([collectPages(usableFiles(files)), fetchChapter(chapterId)]);
  if (chapter.status !== "draft") throw new Error(t("upload.chapterUploadStatus.alreadyTranslated"));
  return uploadManager.resumeChapter({ chapter, pages });
}

export function ChapterUploadStatus(props: {
  chapterId: string;
  onResume: (files: File[]) => void;
  resumeError?: string | null;
}) {
  const { tp } = useT();
  const u = useChapterUpload(props.chapterId);
  const view = uploadManager.view(props.chapterId, u);
  if (!view) return null;
  const pct = u ? (100 * u.bytesDone) / Math.max(u.bytesTotal, 1) : (100 * view.done) / Math.max(view.total, 1);

  return (
    <div className="upload-status" role="status" aria-label={t("upload.chapterUploadStatus.aria")}>
      {view.phase === "uploading" && (
        <span className="status" data-tone="busy">
          {t("upload.chapterUploadStatus.uploading", { done: view.done, total: view.total })}
          {u ? ` · ${fmtBytes(u.bytesDone)}/${fmtBytes(u.bytesTotal)}` : ""}
        </span>
      )}
      {view.phase === "uploaded" && (
        <span className="status" data-tone="ok">
          {tp("upload.chapterUploadStatus.uploaded", view.total)}
        </span>
      )}
      {view.phase === "failed" && (
        <>
          <span className="status" data-tone="danger">
            {tp("upload.chapterUploadStatus.failed", view.total - view.done, { done: view.done, total: view.total })}
          </span>
          <button type="button" onClick={() => uploadManager.retryFailed(props.chapterId)}>
            {t("upload.chapterUploadStatus.retryFailed")}
          </button>
        </>
      )}
      {view.phase === "incomplete" && (
        <>
          <span className="status" data-tone="warn">
            {t("upload.chapterUploadStatus.incomplete", { done: view.done, total: view.total })}
          </span>
          <FilePickButton onFiles={props.onResume}>{t("upload.chapterUploadStatus.resume")}</FilePickButton>
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
