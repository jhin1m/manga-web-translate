/**
 * Thả là dịch (home + series): xác định được series → tạo chương ngay (số đoán từ tên file nếu chưa trùng, không thì
 * số kế tiếp), upload nền + tự dịch khi upload xong, mở thẳng màn chương đầu. Không xác định được series (chưa có
 * series nào, hoặc nhiều series mà chưa từng có chương) hoặc file có vấn đề → trả về null để hiện dòng xác nhận.
 *
 * Series theo thứ tự: (a) series cố định (màn series, nút "+ Ch.N") → (b) tên file khớp series có sẵn → (c) series
 * của chương gần nhất → (d) series duy nhất của bạn.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { fetchSeries, fetchSeriesList, type RecentChapter, type SeriesListItem, seriesKeys } from "../series/api.ts";
import { collectPages, isZip, listProblems, type PageFile } from "../upload/files.ts";
import { naturalSortBy } from "../upload/natural-sort.ts";
import { matchSeries, parseChapterNumber } from "../upload/parse-chapter-filename.ts";
import { uploadManager } from "../upload/upload-manager.ts";

export type Dropped = { zips: { name: string; pages: PageFile[] }[]; loose: PageFile[] };

/** ZIP giải nén riêng từng cái (mỗi ZIP = 1 chương); ảnh lẻ gom chung. */
export async function readDropped(files: File[]): Promise<Dropped> {
  // Thứ tự ZIP = tên tự nhiên (ch9 trước ch10) → đánh số chương liên tiếp đúng thứ tự.
  const zips = naturalSortBy(files.filter(isZip), (f) => f.name);
  const [loose, ...zipPages] = await Promise.all([
    collectPages(files.filter((f) => !isZip(f))),
    ...zips.map((z) => collectPages([z])),
  ]);
  return { loose: loose ?? [], zips: zips.map((z, i) => ({ name: z.name, pages: zipPages[i] ?? [] })) };
}

/** Series đích của lần thả; null = không đoán được (hỏi người dùng). */
export function resolveDropSeries(o: {
  fixedSeriesId?: string;
  fileNames: string[];
  series: readonly { id: string; title: string }[];
  /** Series của chương gần nhất. */
  recentSeriesId?: string | null;
}): string | null {
  if (o.fixedSeriesId) return o.fixedSeriesId;
  for (const name of naturalSortBy(o.fileNames, (n) => n)) {
    const hit = matchSeries(name, o.series);
    if (hit) return hit.id;
  }
  if (o.recentSeriesId && o.series.some((s) => s.id === o.recentSeriesId)) return o.recentSeriesId;
  return o.series.length === 1 ? (o.series[0]?.id ?? null) : null;
}

/** Series có chương cập nhật gần nhất (dự phòng khi "Việc cần làm" chưa tải hoặc rỗng). */
export function latestChapterSeries(series: readonly Pick<SeriesListItem, "id" | "latest_chapter">[]) {
  let best: { id: string; at: string } | null = null;
  for (const s of series) {
    const at = s.latest_chapter?.updated_at;
    if (at && (!best || at > best.at)) best = { id: s.id, at };
  }
  return best?.id ?? null;
}

/**
 * Nhóm chương của lần thả: mỗi ZIP 1 chương (số đoán từ tên ZIP), ảnh lẻ gom 1 chương (số đoán từ tên chỉ khi có
 * đúng 1 ảnh — nhiều ảnh 001…054 là số trang).
 */
export function dropGroups(d: Dropped): { pages: PageFile[]; guess: string | null }[] {
  const zips = d.zips.map((z) => ({ pages: z.pages, guess: parseChapterNumber(z.name) }));
  const loose = d.loose.length
    ? [{ pages: d.loose, guess: d.loose.length === 1 ? parseChapterNumber(d.loose[0]?.name ?? "") : null }]
    : [];
  return [...zips, ...loose].filter((g) => g.pages.length > 0);
}

/** Số cho từng chương: số đoán nếu chưa có trong series (và chưa dùng ở lần thả này), không thì số kế tiếp còn trống. */
export function chapterNumbers(guesses: (string | null)[], taken: readonly string[]): string[] {
  const used = new Set(taken.map(Number));
  let next = Math.floor(Math.max(0, ...used)) + 1;
  return guesses.map((g) => {
    if (g !== null && !used.has(Number(g))) {
      used.add(Number(g));
      return g;
    }
    while (used.has(next)) next++;
    used.add(next);
    return String(next);
  });
}

/**
 * Thả file → tạo chương + tự dịch + mở chương đầu. `onFallback` nhận lại bộ file khi không tự làm được (series
 * không đoán được, file lỗi) để hiện dòng xác nhận.
 */
export function useDropToTranslate(onFallback: (files: File[], seriesId?: string) => void) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ files, seriesId: fixed }: { files: File[]; seriesId?: string }) => {
      const { series } = await qc.ensureQueryData({
        queryKey: seriesKeys.list(),
        queryFn: () => fetchSeriesList(),
      });
      const recent = qc.getQueryData<{ chapters: RecentChapter[] }>(seriesKeys.recent());
      const seriesId = resolveDropSeries({
        fixedSeriesId: fixed,
        fileNames: files.map((f) => f.name),
        series,
        recentSeriesId: recent?.chapters[0]?.series_id ?? latestChapterSeries(series),
      });
      if (!seriesId) return { fallback: true as const, files, seriesId: fixed };
      const groups = dropGroups(await readDropped(files));
      if (!groups.length || groups.some((g) => listProblems(g.pages).length)) {
        return { fallback: true as const, files, seriesId: fixed };
      }
      // Danh sách chương mới nhất (vừa thả lần trước có thể chưa vào cache) → không cấp trùng số.
      const detail = await qc.fetchQuery({
        queryKey: seriesKeys.detail(seriesId),
        queryFn: () => fetchSeries(seriesId),
        staleTime: 0,
      });
      const numbers = chapterNumbers(
        groups.map((g) => g.guess),
        detail.chapters.map((c) => c.number),
      );
      let first: string | null = null;
      for (const [i, g] of groups.entries()) {
        const { chapterId } = await uploadManager.startNewChapter({
          seriesId,
          number: numbers[i] ?? "1",
          pages: g.pages,
        });
        first ??= chapterId;
      }
      return { fallback: false as const, seriesId, chapterId: first };
    },
    onSuccess: (r) => {
      if (r.fallback) return onFallback(r.files, r.seriesId);
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
      if (r.chapterId) {
        void navigate({
          to: "/s/$seriesId/c/$chapterId",
          params: { seriesId: r.seriesId, chapterId: r.chapterId },
        });
      }
    },
  });
}
