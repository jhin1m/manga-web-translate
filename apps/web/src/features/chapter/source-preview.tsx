/**
 * Xem trước ảnh gốc của chương khi chưa có page (nháp, đang cắt trang, cắt lỗi): thứ tự = thứ tự upload, để
 * kiểm đúng bộ file trước khi bấm "Dịch chương". File upload trong tab này hiện ngay từ Blob local; còn lại dùng
 * URL ký từ server — file chưa tải lên (404) hiện ô "chưa tải", thử lại mỗi khi upload xong thêm file.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { uploadManager, useChapterUpload } from "../upload/upload-manager.ts";
import { chapterKeys, fetchSourceFiles } from "./api.ts";

export function SourcePreview(props: { ws: string; chapterId: string }) {
  const { ws, chapterId } = props;
  const upload = useChapterUpload(chapterId);
  const q = useQuery({
    queryKey: chapterKeys.sourceFiles(ws, chapterId),
    queryFn: () => fetchSourceFiles(ws, chapterId),
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
  });
  // Lượt upload mới (total đổi) → lấy lại bộ Blob local.
  // biome-ignore lint/correctness/useExhaustiveDependencies: upload?.total chỉ dùng để kích hoạt lấy lại
  const blobs = useMemo(() => uploadManager.localFiles(chapterId), [chapterId, upload?.total]);
  const [localUrls, setLocalUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const urls = new Map([...blobs].map(([id, b]) => [id, URL.createObjectURL(b)]));
    setLocalUrls(urls);
    return () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    };
  }, [blobs]);

  const files = q.data?.files ?? [];
  if (files.length === 0) return null;
  return (
    <ol className="source-preview" aria-label="Ảnh gốc đã tải">
      {files.map((f) => (
        <SourceImage key={f.id} ord={f.ord} src={localUrls.get(f.id) ?? f.url} retryKey={upload?.done ?? 0} />
      ))}
    </ol>
  );
}

function SourceImage(props: { ord: number; src: string; retryKey: number }) {
  const [missing, setMissing] = useState(false);
  // Upload xong thêm file → thử tải lại ô đang "chưa tải".
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey chỉ dùng để kích hoạt thử lại
  useEffect(() => setMissing(false), [props.retryKey, props.src]);
  return (
    <li>
      <span className="small muted">Ảnh {props.ord + 1}</span>
      {missing ? (
        <div className="source-preview-missing small muted">Chưa tải</div>
      ) : (
        <img src={props.src} alt={`Ảnh gốc ${props.ord + 1}`} loading="lazy" onError={() => setMissing(true)} />
      )}
    </li>
  );
}
