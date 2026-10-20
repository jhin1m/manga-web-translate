/**
 * Thanh trên màn chương: ← series, tên chương, trạng thái bằng lời, chế độ xem Gốc/Dịch/Chia đôi, menu phụ (Dịch
 * lại / Huỷ / Xuất), Hoạt động (+ số việc đang chạy), bảng phím tắt và nút chính theo trạng thái
 * (primary-action.ts; "Xuất" mở drawer Xuất). Dưới nó là băng khoá: ai đang giữ khoá + trạng thái lưu.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LockState } from "../chapter/use-chapter-lock.ts";
import { type ReadOnlyReason, type SaveStatus, useEditor } from "../editor/store.ts";
import type { ChapterStatus } from "../series/api.ts";
import { FilePickButton } from "../upload/drop-zone.tsx";
import { ActivityButton } from "./activity-drawer.tsx";
import type { ChapterDetail } from "./api.ts";
import type { ChapterCommand, PrimaryAction } from "./primary-action.ts";
import { CHAPTER_STATUS } from "./status.ts";
import { ViewModeSwitch } from "./view-mode-switch.tsx";

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Đã lưu",
  dirty: "Chưa lưu",
  saving: "Đang lưu…",
  error: "Lỗi lưu",
};
const SAVE_TONE = { saved: "ok", dirty: "idle", saving: "busy", error: "danger" } as const;

export function ChapterTopbar(props: {
  ws: string;
  seriesId: string;
  detail: ChapterDetail | undefined;
  status: ChapterStatus | undefined;
  /** "AI xong 54/54 · 3 cần xem". */
  summary: string | null;
  primary: PrimaryAction | null;
  pending: boolean;
  onCommand(cmd: ChapterCommand): void;
  onUploadFiles(files: File[]): void;
  /** Lưu xong rồi mới rời (giữ href cho mở tab mới). */
  onBack(): void;
  /** Số việc đang chạy (upload, job chương, xuất). */
  activityCount: number;
  onActivity(): void;
  onHelp(): void;
}) {
  const { detail, primary } = props;
  const st = props.status ? CHAPTER_STATUS[props.status] : null;
  const menu = primary?.menu ?? [];
  const has = (c: ChapterCommand) => menu.some((m) => m.command === c);

  return (
    <header className="cw-top">
      <Link
        to="/w/$ws/s/$seriesId"
        params={{ ws: props.ws, seriesId: props.seriesId }}
        className="cw-back"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          props.onBack();
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {detail?.series.title ?? "Series"}
      </Link>
      <h1 className="cw-title">
        Chương {detail?.number ?? "…"}
        {detail?.title ? ` · ${detail.title}` : ""}
      </h1>
      {st && (
        <span className="status" data-tone={st.tone}>
          {st.label}
          {props.summary ? ` · ${props.summary}` : ""}
        </span>
      )}
      <span className="spacer" />
      <ViewModeSwitch />
      {has("retranslate") && (
        <details className="cw-menu">
          <summary className="btn">Dịch lại ▾</summary>
          <div className="cw-menu-list" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={props.pending}
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
                props.onCommand("retranslate");
              }}
            >
              Dịch lại cả chương
            </button>
          </div>
        </details>
      )}
      {has("cancel") && (
        <button type="button" className="btn-danger" disabled={props.pending} onClick={() => props.onCommand("cancel")}>
          Huỷ xử lý
        </button>
      )}
      <ActivityButton count={props.activityCount} onClick={props.onActivity} />
      <button type="button" className="btn-ghost" aria-label="Phím tắt" title="Phím tắt (?)" onClick={props.onHelp}>
        ?
      </button>
      {has("export") && (
        <button type="button" onClick={() => props.onCommand("export")}>
          Xuất
        </button>
      )}
      {primary &&
        (primary.command === "upload" ? (
          <FilePickButton className="btn-primary" onFiles={props.onUploadFiles}>
            {primary.label}
          </FilePickButton>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={primary.disabled || props.pending || primary.command === null}
            title={primary.title}
            onClick={() => primary.command && props.onCommand(primary.command)}
          >
            {primary.label}
          </button>
        ))}
    </header>
  );
}

const READ_ONLY_TEXT: Partial<Record<Exclude<ReadOnlyReason, null>, string>> = {
  processing: "Đang dịch — sửa được khi xong",
  lock_lost: "Mất khoá chương (hết hạn hoặc người khác đã mở) — thay đổi chưa lưu vẫn giữ trên máy này; đang chỉ xem",
  recovery: "Có thay đổi chưa lưu từ phiên trước — chọn Khôi phục hoặc Bỏ để sửa tiếp",
};

/** Băng dưới thanh trên: khoá chương + trạng thái lưu. */
export function LockBand(props: {
  status: ChapterStatus | undefined;
  hasPages: boolean;
  lock: LockState;
  lockEnabled: boolean;
  onRetryLock(): void;
}) {
  const readOnly = useEditor((s) => s.readOnly);
  const save = useEditor((s) => s.save);
  let text: ReactNode;
  let tone: "ok" | "busy" | "warn" | "danger" | "idle" = "idle";
  if (props.status === "draft") text = "Chương nháp — tải đủ ảnh rồi bấm Dịch chương";
  else if (!props.hasPages) text = "Đang cắt trang theo bóng thoại…";
  else if (!props.lockEnabled) {
    text = READ_ONLY_TEXT.processing;
    tone = "busy";
  } else if (props.lock.status === "denied") {
    tone = "warn";
    text = (
      <>
        {props.lock.holderName ?? "Người khác"} đang sửa chương này — bạn chỉ xem được.{" "}
        <button type="button" className="btn-ghost" onClick={props.onRetryLock}>
          Thử lại
        </button>
      </>
    );
  } else if (props.lock.status === "error") {
    tone = "danger";
    text = `Không lấy được khoá chương: ${props.lock.message}`;
  } else if (props.lock.status === "acquiring") text = "Đang lấy khoá chương…";
  else {
    const ro = readOnly ? READ_ONLY_TEXT[readOnly] : undefined;
    tone = ro ? (readOnly === "lock_lost" ? "danger" : "warn") : "ok";
    text = ro ?? "Bạn đang giữ khoá chương";
  }
  return (
    <div className="cw-band" role="status" aria-label="Khoá chương">
      <span className="status" data-tone={tone}>
        {text}
      </span>
      {props.hasPages && (
        <span className="status" data-tone={SAVE_TONE[save.status]} title={save.error ?? undefined}>
          {SAVE_LABEL[save.status]}
        </span>
      )}
    </div>
  );
}
