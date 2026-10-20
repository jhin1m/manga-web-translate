/**
 * "Việc cần làm": mọi chương chưa xong của workspace (chương mình đang giữ khoá trước, rồi mới cập nhật nhất),
 * mỗi dòng 1 nút bước tiếp theo suy từ trạng thái + upload đang chạy trong tab.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { ChapterActionButton } from "../chapter/chapter-action-button.tsx";
import { nextAction } from "../chapter/next-action.ts";
import { fetchRecentChapters, type RecentChapter, seriesKeys } from "../series/api.ts";
import { uploadManager, useUploads } from "../upload/upload-manager.ts";

const BUSY = new Set(["ingesting", "processing"]);

export function TodoList({ ws }: { ws: string }) {
  const uploads = useUploads();
  const q = useQuery({
    queryKey: seriesKeys.recent(ws),
    queryFn: () => fetchRecentChapters(ws),
    refetchInterval: (query) => (query.state.data?.chapters.some((c) => BUSY.has(c.status)) ? 5000 : false),
  });
  const list = q.data?.chapters ?? [];

  return (
    <section aria-label="Việc cần làm" className="block">
      <div className="block-head">
        <h2>Việc cần làm</h2>
        <span className="small muted">mỗi chương một bước tiếp theo, bấm là làm</span>
      </div>
      {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
      <div className="rows">
        {q.data && list.length === 0 && (
          <div className="rows-empty">Không có chương nào đang dở. Thả strip ở trên để bắt đầu chương mới.</div>
        )}
        {list.map((ch, i) => (
          <TodoRow key={ch.id} ws={ws} ch={ch} first={i === 0} upload={uploadManager.view(ch.id, uploads[ch.id])} />
        ))}
      </div>
    </section>
  );
}

function TodoRow(props: {
  ws: string;
  ch: RecentChapter;
  first: boolean;
  upload: ReturnType<typeof uploadManager.view>;
}) {
  const { ws, ch } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const a = nextAction(ch, props.upload);
  return (
    <div className="row-item" data-chapter={ch.id}>
      <span className="dot" data-tone={a.tone} title={a.state} />
      <div className="row-title">
        <Link to="/w/$ws/s/$seriesId/c/$chapterId" params={{ ws, seriesId: ch.series_id, chapterId: ch.id }}>
          Chương {ch.number}
        </Link>
        <span className="row-sub">{ch.series_title}</span>
      </div>
      <div className="grow">
        {a.state} · {a.detail}
      </div>
      <ChapterActionButton ws={ws} chapter={ch} action={a} primary={props.first} onMessage={setMsg} />
      {msg && <div className="row-error">{msg}</div>}
    </div>
  );
}
