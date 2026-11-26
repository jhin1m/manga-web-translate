/**
 * Trạng thái page gom về 4 mức người dùng hiểu được (cột trang, panel Chọn) + cờ "cần xem" + nhãn/viền thumbnail.
 * Thuần: chỉ đọc `ProgressPage`.
 */
import { ACTIVE_JOB_STATUSES } from "@mtl/shared";
import { type MessageKey, t, tp } from "../../i18n/t.ts";
import type { ProgressPage } from "./api.ts";
import { describeJobError, waitingOnProvider } from "./job-error.ts";
import { stageLabel } from "./stage-labels.ts";
import type { PageStatus, Tone } from "./status.ts";

export type PageLevel = "todo" | "busy" | "done" | "error";

/** `label` là getter: đọc ngôn ngữ lúc dùng, không lúc import. */
const levelEntry = (key: MessageKey, tone: Tone) => ({
  get label() {
    return t(key);
  },
  tone,
});

export const PAGE_LEVEL: Record<PageLevel, { label: string; tone: Tone }> = {
  todo: levelEntry("chapter.pageStatus.level.todo", "idle"),
  busy: levelEntry("chapter.pageStatus.level.busy", "busy"),
  done: levelEntry("chapter.pageStatus.level.done", "ok"),
  error: levelEntry("chapter.pageStatus.level.error", "danger"),
};

const LEVEL: Record<PageStatus, PageLevel> = {
  pending: "busy",
  preparing: "busy",
  prepared: "todo",
  translating: "busy",
  ready: "done",
  failed: "error",
};

export const pageLevel = (s: PageStatus): PageLevel => LEVEL[s];

const ACTIVE = new Set<string>(ACTIVE_JOB_STATUSES);

/** Page nằm trong job dịch còn hoạt động — kể cả lúc job còn xếp hàng (page vẫn `prepared`/`ready` tới khi worker nhận). */
export const inTranslateJob = (p: Pick<ProgressPage, "job">) =>
  p.job?.type === "chapter.translate" && ACTIVE.has(p.job.status);

type LevelPage = Pick<ProgressPage, "status" | "job"> & { translate_queued?: boolean };

/**
 * Mức hiển thị của page: như `pageLevel`, nhưng page đang chờ job dịch, hoặc còn chờ lượt trong lượt dịch đang mở
 * (kể cả trang lỗi đem dịch lại), tính là "Đang xử lý".
 */
export const pageLevelOf = (p: LevelPage): PageLevel =>
  (inTranslateJob(p) && p.status !== "failed") || p.translate_queued ? "busy" : LEVEL[p.status];

/** Page AI đang/sắp ghi: đang xử lý, hoặc còn chờ lượt trong lượt dịch đang mở → chỉ xem, không chọn để dịch. */
export const isPageBusy = (p: LevelPage) => pageLevelOf(p) === "busy";

/**
 * Page cần người xem lại: lỗi, AI có bản mới cho page đã sửa tay, hoặc có box chữ tràn khung (`overflow`, đo ở
 * client từ bảng văn bản).
 */
export const needsReview = (p: { status: PageStatus; ai_update_available: boolean }, overflow = false) =>
  p.status === "failed" || p.ai_update_available || overflow;

type ThumbPage = Pick<ProgressPage, "ord" | "status" | "skipped" | "ai_update_available" | "cut_flag" | "job"> &
  Partial<Pick<ProgressPage, "translate_queued" | "run_batch">>;

/**
 * Nhãn + viền thumbnail cột trang; trang yên (Chờ dịch / Xong) không có nhãn. Trang đang chạy AI có nhãn bước + `progress`
 * (0..1, null khi job còn xếp hàng) để vẽ thanh tiến độ trong thumbnail.
 */
export type ThumbMark =
  | { tone: "hidden" | "danger" | "warn"; label: string }
  | { tone: "busy"; label: string; progress: number | null }
  | null;

/** Nhãn bước khi job chưa báo bước nào (vừa claim / worker cũ). */
const BUSY_STEP: Partial<Record<PageStatus, MessageKey>> = {
  pending: "chapter.pageStatus.busyStep.prepare",
  preparing: "chapter.pageStatus.busyStep.prepare",
  translating: "chapter.pageStatus.busyStep.translate",
};

/**
 * Ưu tiên: ẩn > lỗi (chưa vào lượt dịch lại) > chờ AI tự thử lại > chờ lượt (lô sau của lượt dịch) > đang xử lý > cần xem (AI có bản mới, tràn
 * khung) > bình thường.
 */
export function thumbMark(p: ThumbPage, overflow: boolean): ThumbMark {
  if (p.skipped) return { tone: "hidden", label: t("chapter.pageStatus.mark.hidden") };
  if (p.status === "failed" && !p.translate_queued)
    return { tone: "danger", label: t("chapter.pageStatus.mark.error") };
  if (waitingOnProvider(p.job)) return { tone: "warn", label: t("chapter.pageStatus.mark.waitingAi") };
  // Trang còn xoá chữ hiện bước xoá chữ; trang của lô đang chạy hiện bước dịch.
  if (p.translate_queued && !BUSY_STEP[p.status] && !inTranslateJob(p)) {
    const label = p.run_batch
      ? t("chapter.pageStatus.queuedBatch", { batch: p.run_batch })
      : t("chapter.pageStatus.queued");
    return { tone: "busy", label, progress: null };
  }
  const fallbackKey = BUSY_STEP[p.status] ?? (inTranslateJob(p) ? "chapter.pageStatus.busyStep.translate" : undefined);
  if (fallbackKey) {
    const fallback = t(fallbackKey);
    const running = p.job?.status === "running";
    const progress = running ? Math.min(1, Math.max(0, p.job?.progress ?? 0)) : null;
    if (progress === null) {
      const label =
        p.status === "pending" || p.status === "preparing"
          ? t("chapter.pageStatus.waitClean")
          : t("chapter.pageStatus.stepWaiting", { step: fallback });
      return { tone: "busy", label, progress };
    }
    const step = stageLabel(p.job, { short: true }) ?? fallback;
    return { tone: "busy", label: `${step} · ${Math.round(progress * 100)}%`, progress };
  }
  if (needsReview(p, overflow)) return { tone: "warn", label: t("chapter.pageStatus.mark.review") };
  return null;
}

/** Cờ chi tiết của trang (title thumbnail, tên truy cập). */
export function thumbFlags(p: ThumbPage, overflow: boolean): string[] {
  return [
    p.ai_update_available && t("chapter.pageStatus.flag.aiUpdate"),
    overflow && t("chapter.pageStatus.flag.overflow"),
    p.cut_flag && t("chapter.pageStatus.flag.cutAtMaxHeight"),
    waitingOnProvider(p.job) && t("chapter.pageStatus.flag.waitingRetry"),
  ].filter((f): f is string => !!f);
}

/** Tên truy cập luôn đủ trạng thái: "Trang 3 · Xong", "Trang 2 · Cần xem: tràn khung", "Trang 7 · Lỗi". */
export function thumbAria(p: ThumbPage, overflow: boolean): string {
  const mark = thumbMark(p, overflow);
  const head = t("chapter.pageStatus.aria", {
    page: p.ord + 1,
    state: mark?.label ?? PAGE_LEVEL[pageLevelOf(p)].label,
  });
  if (mark?.label !== t("chapter.pageStatus.mark.review")) return head;
  const waitingRetry = t("chapter.pageStatus.flag.waitingRetry");
  const flags = thumbFlags(p, overflow).filter((f) => f !== waitingRetry);
  return flags.length ? `${head}: ${flags.join(", ")}` : head;
}

export const isMacPlatform = (platform: string) => /mac|iphone|ipad|ipod/i.test(platform);

/** Nền tảng của trình duyệt đang chạy (false ngoài trình duyệt, VD test). */
const IS_MAC =
  typeof navigator !== "undefined" &&
  isMacPlatform(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "",
  );

/** Gợi ý chọn trang ở cột trang: macOS Ctrl-click là chuột phải (mở menu Ẩn trang) → chỉ ⌘ chọn được. */
export const selectHint = (mac = IS_MAC) => t("chapter.pageStatus.selectHint", { key: mac ? "⌘" : "Ctrl" });

/** Cờ góc thumbnail: "!" cần xem / chờ AI, "×" lỗi. `text` = tên truy cập + tooltip ("Lỗi: <câu lỗi job>"). */
export type ThumbFlag = { glyph: "!" | "×"; tone: "warn" | "danger"; text: string };

export function thumbFlag(p: ThumbPage, overflow: boolean): ThumbFlag | null {
  const mark = thumbMark(p, overflow);
  if (mark?.tone !== "warn" && mark?.tone !== "danger") return null;
  const detail = describeJobError(p.job)?.text ?? thumbFlags(p, overflow).join(", ");
  return {
    glyph: mark.tone === "danger" ? "×" : "!",
    tone: mark.tone,
    // Câu lỗi job đã mở đầu bằng "Lỗi:" → không lặp nhãn.
    text: !detail ? mark.label : detail.startsWith(`${mark.label}:`) ? detail : `${mark.label}: ${detail}`,
  };
}

/**
 * Title thumbnail: bước đang chạy (nhãn thumbnail không còn chữ), câu lỗi job hoặc cờ chi tiết; kèm gợi ý thao tác.
 * Trang đang mở có nút ⋯ nên gợi ý menu trang; trang khác chỉ ẩn được bằng chuột phải.
 */
export function thumbTitle(p: ThumbPage, overflow: boolean, mac = IS_MAC, active = false): string {
  const mark = thumbMark(p, overflow);
  const step = mark?.tone === "busy" ? mark.label : null;
  const detail = describeJobError(p.job)?.text ?? thumbFlags(p, overflow).join(" · ");
  const hint = p.skipped
    ? t("chapter.pageStatus.hint.restore")
    : `${active ? t("chapter.pageStatus.hint.activeMenu") : t("chapter.pageStatus.hint.hide")} · ${selectHint(mac)}`;
  return [step, detail, hint].filter(Boolean).join("\n");
}

/** Một dòng tóm tắt trang của chương: "35 trang · 30 xong · 5 lỗi"; bỏ số 0. */
export function pageSummary(total: number, busy: number, failed: number) {
  const done = total - busy - failed;
  return [
    tp("common.pages", total),
    done > 0 && t("chapter.pageStatus.summary.done", { count: done }),
    busy > 0 && t("chapter.pageStatus.summary.busy", { count: busy }),
    failed > 0 && t("chapter.pageStatus.summary.failed", { count: failed }),
  ]
    .filter(Boolean)
    .join(" · ");
}
