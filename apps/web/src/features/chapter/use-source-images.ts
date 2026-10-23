/**
 * Ảnh gốc của chương chưa có page (nháp, đang cắt trang, cắt lỗi) cho rail + canvas: thứ tự upload, file thả trong
 * tab này hiện ngay từ Blob local, còn lại dùng URL ký (file chưa tải lên → 404, giao diện hiện "Chưa tải").
 *
 * Bỏ qua / khôi phục ảnh: cập nhật lạc quan cả danh sách ảnh lẫn chi tiết chương (nút Bước 1 đếm ảnh còn dùng), rồi
 * ghi giá trị server trả về vào cache — không lấy lại danh sách (mỗi lần lấy là URL ký mới → trình duyệt tải lại mọi
 * ảnh đang hiện). Bấm liên tiếp trên cùng 1 ảnh: chỉ kết quả của lần bấm cuối được ghi. Đổi thứ tự cũng lạc quan và
 * chạy nối tiếp (mỗi PUT gửi cả bộ id, chạy song song thì thứ tự chốt ở server có thể khác thứ tự đang hiện); xong thì
 * ghi thứ tự server trả về; lỗi → trả về thứ tự trước đó (nếu chưa có lần đổi nào mới hơn).
 */
import type { SourceSkipReason } from "@mtl/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadManager, useChapterUpload } from "../upload/upload-manager.ts";
import {
  type ChapterDetail,
  chapterKeys,
  fetchSourceFiles,
  type SourceFileImage,
  setSourceOrder,
  setSourceSkip,
} from "./api.ts";
import { type SourceItem, sourceItems } from "./source-rail-model.ts";

export function useSourceImages(ws: string, chapterId: string, enabled: boolean): SourceItem[] {
  const upload = useChapterUpload(chapterId);
  const q = useQuery({
    queryKey: chapterKeys.sourceFiles(ws, chapterId),
    queryFn: () => fetchSourceFiles(ws, chapterId),
    enabled,
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
  // upload.files giữ nguyên object khi không file nào đổi trạng thái → danh sách chỉ dựng lại khi thật sự đổi.
  // biome-ignore lint/correctness/useExhaustiveDependencies: upload?.files đại diện cho upload (cùng nguồn)
  return useMemo(
    () => sourceItems(q.data?.files ?? [], localUrls, upload?.files, uploadManager.uploadedIds(chapterId, upload)),
    [q.data, localUrls, upload?.files, chapterId],
  );
}

type SkipVars = { id: string; skip: Extract<SourceSkipReason, "user"> | null };
type SkipValue = SourceSkipReason | null;
type FilesData = { expires_at: string; files: SourceFileImage[] };

export function useSetSourceSkip(ws: string, chapterId: string, onError: (e: unknown) => void) {
  const qc = useQueryClient();
  const filesKey = chapterKeys.sourceFiles(ws, chapterId);
  const detailKey = chapterKeys.detail(ws, chapterId);
  /** Lần bấm mới nhất của từng ảnh — kết quả của lần bấm cũ hơn không được ghi đè lên. */
  const latest = useRef(new Map<string, number>());
  const seq = useRef(0);

  /** Ghi `skip` của 1 ảnh vào cả 2 cache (không đụng ảnh khác — thao tác song song trên ảnh khác giữ nguyên). */
  const write = (id: string, skip: SkipValue) => {
    const patch = <T extends { id: string; skip: SkipValue }>(list: T[]) =>
      list.map((f) => (f.id === id ? { ...f, skip } : f));
    qc.setQueryData<FilesData>(filesKey, (d) => d && { ...d, files: patch(d.files) });
    qc.setQueryData<ChapterDetail>(detailKey, (d) => d && { ...d, source_files: patch(d.source_files) });
  };

  return useMutation({
    mutationFn: ({ id, skip }: SkipVars) => setSourceSkip(ws, chapterId, id, skip),
    onMutate: async ({ id, skip }: SkipVars) => {
      // Chỉ huỷ đúng 2 truy vấn này (detailKey là tiền tố của progress/pages/states).
      await Promise.all([
        qc.cancelQueries({ queryKey: filesKey, exact: true }),
        qc.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const before = qc.getQueryData<FilesData>(filesKey)?.files.find((f) => f.id === id)?.skip ?? null;
      const n = ++seq.current;
      latest.current.set(id, n);
      write(id, skip);
      return { n, before };
    },
    onSuccess: (row, { id }, ctx) => {
      if (latest.current.get(id) === ctx.n) write(id, row.skip);
    },
    onError: (e, { id }, ctx) => {
      if (ctx && latest.current.get(id) === ctx.n) write(id, ctx.before);
      onError(e);
    },
  });
}

/** Ghi `ord = vị trí trong ids` cho các ảnh có trong `ids` rồi xếp lại danh sách theo `ord`. */
const applyOrder = <T extends { id: string; ord: number }>(list: T[], ids: string[]): T[] => {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return list.map((f) => ({ ...f, ord: pos.get(f.id) ?? f.ord })).sort((a, b) => a.ord - b.ord);
};

const idsOf = (list: { id: string }[] | undefined) => list?.map((f) => f.id);

export function useReorderSources(ws: string, chapterId: string, onError: (e: unknown) => void) {
  const qc = useQueryClient();
  const filesKey = chapterKeys.sourceFiles(ws, chapterId);
  const detailKey = chapterKeys.detail(ws, chapterId);
  const seq = useRef(0);

  /** Ghi thứ tự `ids` vào cả 2 cache; cache nào chưa có dữ liệu thì bỏ qua. */
  const write = (ids: string[]) => {
    qc.setQueryData<FilesData>(filesKey, (d) => d && { ...d, files: applyOrder(d.files, ids) });
    qc.setQueryData<ChapterDetail>(detailKey, (d) => d && { ...d, source_files: applyOrder(d.source_files, ids) });
  };

  return useMutation({
    // Các lần đổi chạy lần lượt theo thứ tự bấm: PUT cuối cùng là thứ tự người dùng đang thấy.
    scope: { id: `reorder-sources-${chapterId}` },
    mutationFn: ({ ids }: { ids: string[] }) => setSourceOrder(ws, chapterId, ids),
    onMutate: async ({ ids }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: filesKey, exact: true }),
        qc.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      // Mỗi cache hoàn lại thứ tự của chính nó (cache này trống thì không có gì để hoàn).
      const before = {
        files: idsOf(qc.getQueryData<FilesData>(filesKey)?.files),
        detail: idsOf(qc.getQueryData<ChapterDetail>(detailKey)?.source_files),
      };
      const n = ++seq.current;
      write(ids);
      return { n, before };
    },
    onSuccess: (res, _vars, ctx) => {
      if (seq.current === ctx.n) write(res.source_files.map((f) => f.id));
    },
    onError: (e, _vars, ctx) => {
      if (ctx && seq.current === ctx.n) {
        qc.setQueryData<FilesData>(
          filesKey,
          (d) => d && (ctx.before.files ? { ...d, files: applyOrder(d.files, ctx.before.files) } : d),
        );
        qc.setQueryData<ChapterDetail>(
          detailKey,
          (d) => d && (ctx.before.detail ? { ...d, source_files: applyOrder(d.source_files, ctx.before.detail) } : d),
        );
      }
      onError(e);
    },
  });
}
