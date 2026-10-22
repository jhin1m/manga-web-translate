/**
 * Dữ liệu màn chương: chi tiết + khoá (15s), tiến độ (2.5s khi chương chưa ổn định), danh sách page + URL ảnh
 * ký (làm mới 12'), state mọi page (`/states`, tải lại khi tiến độ báo version mới). Đồng bộ meta page + state vào
 * `chapterStore` cho canvas/rail.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { chapterStore, type PageMeta } from "../editor/chapter-store.ts";
import { seriesKeys } from "../series/api.ts";
import {
  chapterKeys,
  fetchChapter,
  fetchChapterStates,
  fetchPages,
  fetchProgress,
  type PageImage,
  type ProgressPage,
} from "./api.ts";
import { isChapterSettled } from "./status.ts";

export const PROGRESS_POLL_MS = 2500;
const LOCK_POLL_MS = 15_000;
const STATES_DEBOUNCE_MS = 1000;
const URL_REUSE_MS = 10 * 60_000;
const NO_HIDDEN: ProgressPage[] = [];

/**
 * Giữ nguyên URL ảnh của page khi ảnh không đổi (cùng clean_rev) — mỗi lần ký lại cho URL mới khiến trình
 * duyệt tải lại cả ảnh. Chỉ thay URL khi clean_rev đổi hoặc URL cũ sắp hết hạn (ký 15').
 */
export function useStableImages(list: PageImage[] | undefined): Map<string, PageImage> {
  const cache = useRef(new Map<string, { img: PageImage; at: number }>());
  const out = new Map<string, PageImage>();
  for (const p of list ?? []) {
    const key = `${p.id}:${p.clean_rev ?? "o"}`;
    const hit = cache.current.get(key);
    if (hit && Date.now() - hit.at < URL_REUSE_MS) out.set(p.id, hit.img);
    else {
      cache.current.set(key, { img: p, at: Date.now() });
      out.set(p.id, p);
    }
  }
  return out;
}

export function useChapterData(ws: string, chapterId: string) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: chapterKeys.detail(ws, chapterId),
    queryFn: () => fetchChapter(ws, chapterId),
    refetchInterval: LOCK_POLL_MS,
  });
  const progressQ = useQuery({
    queryKey: chapterKeys.progress(ws, chapterId),
    queryFn: () => fetchProgress(ws, chapterId),
    // Dừng khi chương ổn định hoặc request lỗi (refetch lại khi người dùng thao tác/focus tab).
    refetchInterval: (q) =>
      q.state.status === "error" || isChapterSettled(q.state.data?.chapter.status) ? false : PROGRESS_POLL_MS,
    refetchIntervalInBackground: false,
  });
  // Trang đã xoá (ẩn) tách riêng: mọi chỗ khác (canvas, bảng, xuất, đếm) chỉ thấy trang còn hiện; rail dùng danh sách
  // ẩn cho bộ lọc "Đã xoá" để khôi phục.
  const raw = progressQ.data;
  const progress = useMemo(() => raw && { ...raw, pages: raw.pages.filter((p) => !p.skipped) }, [raw]);
  const hiddenPages = useMemo(() => raw?.pages.filter((p) => p.skipped) ?? NO_HIDDEN, [raw]);
  const progressPages = progress?.pages;
  const hasPages = (progressPages?.length ?? 0) > 0;
  // URL ảnh ký 15': lấy lại danh sách khi tập page/clean_rev đổi hoặc gần hết hạn.
  const pagesSig = (progressPages ?? []).map((p) => `${p.id}:${p.clean_rev ?? "o"}`).join(",");
  const pagesQ = useQuery({
    queryKey: chapterKeys.pages(ws, chapterId, pagesSig),
    queryFn: () => fetchPages(ws, chapterId),
    enabled: hasPages,
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
    placeholderData: (prev) => prev,
  });
  const statesQ = useQuery({
    queryKey: chapterKeys.states(ws, chapterId),
    queryFn: () => fetchChapterStates(ws, chapterId),
    enabled: hasPages,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const images = useStableImages(pagesQ.data?.pages);

  // Meta page → chapterStore (offset strip).
  useEffect(() => {
    if (!progressPages) return;
    chapterStore.getState().setPages(
      progressPages.map(
        (p): PageMeta => ({
          id: p.id,
          ord: p.ord,
          width: p.width,
          height: p.height,
          status: p.status,
          version: p.version,
          clean_rev: p.clean_rev,
          ai_update_available: p.ai_update_available,
        }),
      ),
    );
  }, [progressPages]);

  useEffect(() => {
    if (statesQ.data) chapterStore.getState().setStates(statesQ.data.pages);
  }, [statesQ.data]);

  // Tiến độ báo page có version mới hơn cache (AI dịch xong, sửa ở tab khác…) → tải lại state (gộp 1s).
  useEffect(() => {
    if (!progressPages || !statesQ.data) return;
    const cache = chapterStore.getState().cache;
    const stale = progressPages.some((p) => p.version > (cache[p.id]?.version ?? -1));
    if (!stale) return;
    const t = setTimeout(
      () => void qc.invalidateQueries({ queryKey: chapterKeys.states(ws, chapterId) }),
      STATES_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [progressPages, statesQ.data, qc, ws, chapterId]);

  // Trạng thái chương đổi (worker xong, commit…) → danh sách ở home/series ("Việc cần làm", hàng chương) cũ.
  const liveStatus = progressQ.data?.chapter.status;
  useEffect(() => {
    if (liveStatus) void qc.invalidateQueries({ queryKey: seriesKeys.list(ws) });
  }, [liveStatus, qc, ws]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["chapter", ws, chapterId] });
    void qc.invalidateQueries({ queryKey: seriesKeys.list(ws) });
  }, [qc, ws, chapterId]);

  /** Tải lại tiến độ ngay; trả chương có ổn định không. */
  const refetchProgress = useCallback(async () => {
    const r = await progressQ.refetch();
    return r.data ? isChapterSettled(r.data.chapter.status) : undefined;
  }, [progressQ.refetch]);

  return {
    detail: detailQ.data,
    progress,
    hiddenPages,
    images,
    error: detailQ.error ?? progressQ.error ?? statesQ.error,
    refresh,
    refetchProgress,
  };
}
