/**
 * Nút "bước tiếp theo" của 1 chương (home "Việc cần làm" + danh sách chương của series): mở chương, Dịch chương
 * (= commit), Chạy lại trang lỗi, hoặc Tải tiếp ảnh (chọn lại file → upload phần thiếu).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { errorMessage } from "../../lib/api.ts";
import type { ChapterRow } from "../series/api.ts";
import { resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { FilePickButton } from "../upload/drop-zone.tsx";
import { commitChapter, REJECT_REASON, retryFailed } from "./api.ts";
import type { NextAction } from "./next-action.ts";

export function ChapterActionButton(props: {
  ws: string;
  chapter: Pick<ChapterRow, "id" | "series_id">;
  action: NextAction;
  primary?: boolean;
  /** Lỗi/ghi chú của thao tác (hiện dưới hàng). */
  onMessage?: (text: string | null) => void;
}) {
  const { ws, chapter, action } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const params = { ws, seriesId: chapter.series_id, chapterId: chapter.id };
  const cls = `btn act ${props.primary ? "btn-primary" : ""}`;
  const run = useMutation({
    mutationFn: async (kind: "translate" | "retry"): Promise<string | null> => {
      if (kind === "retry") {
        await retryFailed(ws, chapter.id);
        return null;
      }
      const r = await commitChapter(ws, chapter.id);
      return r.rejected.length
        ? `Loại ${r.rejected.length} ảnh: ${r.rejected.map((x) => `#${x.ord + 1} ${REJECT_REASON[x.reason]}`).join(", ")}`
        : null;
    },
    onMutate: () => props.onMessage?.(null),
    onSuccess: (text) => props.onMessage?.(text),
    onError: (e) => props.onMessage?.(errorMessage(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["series", ws] }),
  });
  const resume = useMutation({
    mutationFn: (files: File[]) => resumeFromFiles(ws, chapter.id, files),
    onMutate: () => props.onMessage?.(null),
    onSuccess: () => void navigate({ to: "/w/$ws/s/$seriesId/c/$chapterId", params }),
    onError: (e) => props.onMessage?.(errorMessage(e)),
  });

  if (action.kind === "translate" || action.kind === "retry") {
    const kind = action.kind;
    return (
      <button type="button" className={cls} disabled={run.isPending} onClick={() => run.mutate(kind)}>
        {action.action}
      </button>
    );
  }
  if (action.kind === "resume") {
    return (
      <FilePickButton className={cls} onFiles={(f) => resume.mutate(f)}>
        {action.action}
      </FilePickButton>
    );
  }
  return (
    <Link className={cls} to="/w/$ws/s/$seriesId/c/$chapterId" params={params}>
      {action.action}
    </Link>
  );
}
