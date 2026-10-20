/**
 * Thanh trên màn chương: ← series, tên chương (bấm → đổi series / số chương), chip trạng thái chương (chỗ duy nhất nói chương đang ở đâu), chỉ
 * báo sửa/lưu thu nhỏ (giữ khoá · Đã lưu / Chỉ xem), chế độ xem Gốc/Dịch/Chia đôi, Dịch lại ▾, Huỷ xử lý, icon
 * Hoạt động (+ số việc đang chạy) + Phím tắt, và nút chính theo trạng thái (primary-action.ts; "Xuất" mở drawer).
 * Dưới nó là băng cảnh báo — chỉ hiện khi người dùng phải biết/làm gì (khoá bị giữ/mất/lỗi, khôi phục, lỗi lưu).
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LockState } from "../chapter/use-chapter-lock.ts";
import { type ReadOnlyReason, type SaveStatus, useEditor } from "../editor/store.ts";
import type { RecoveryItem } from "../editor/use-chapter-session.ts";
import { FilePickButton } from "../upload/drop-zone.tsx";
import { ActivityButton } from "./activity-drawer.tsx";
import type { ChapterDetail } from "./api.ts";
import { ChapterMetaPopover } from "./chapter-meta-popover.tsx";
import type { ChapterCommand, PrimaryAction } from "./primary-action.ts";
import type { Tone } from "./status.ts";
import { ViewModeSwitch } from "./view-mode-switch.tsx";

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Đã lưu",
  dirty: "Chưa lưu",
  saving: "Đang lưu…",
  error: "Lỗi lưu",
};
const SAVE_TONE = { saved: "ok", dirty: "idle", saving: "busy", error: "danger" } as const;

/** Khoá chương + quyền sửa của tab này (từ useChapterSession). */
export type EditAccess = { lock: LockState; lockEnabled: boolean; hasPages: boolean };

export function ChapterTopbar(props: {
  ws: string;
  seriesId: string;
  detail: ChapterDetail | undefined;
  /** Chip trạng thái chương (status.ts chapterChip). */
  chip: { label: string; tone: Tone } | null;
  access: EditAccess;
  primary: PrimaryAction | null;
  pending: boolean;
  onCommand(cmd: ChapterCommand): void;
  onUploadFiles(files: File[]): void;
  /** Lưu xong rồi mới rời (giữ href cho mở tab mới). */
  onBack(): void;
  /** Đã chuyển chương sang series khác → điều hướng URL mới. */
  onMoved(seriesId: string): void;
  /** Số việc đang chạy (upload, job chương, xuất). */
  activityCount: number;
  onActivity(): void;
  onHelp(): void;
}) {
  const { detail, primary, chip } = props;
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
      <ChapterMetaPopover ws={props.ws} detail={detail} onMoved={props.onMoved} />
      {/* Luôn render vùng live (rỗng khi chưa tải) để trình đọc màn hình báo được lần đổi đầu tiên. */}
      <span className="cw-chip" role="status" aria-live="polite" aria-label="Trạng thái chương">
        {chip && (
          <span className="status" data-tone={chip.tone}>
            {chip.label}
          </span>
        )}
      </span>
      <EditState {...props.access} />
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
      {has("export") && (
        <button type="button" onClick={() => props.onCommand("export")}>
          Xuất
        </button>
      )}
      <span className="cw-icons">
        <ActivityButton icon count={props.activityCount} onClick={props.onActivity} />
        <button type="button" className="btn-ghost" aria-label="Phím tắt" title="Phím tắt (?)" onClick={props.onHelp}>
          ?
        </button>
      </span>
      {primary &&
        (primary.command === "upload" ? (
          <FilePickButton className="btn-primary" onFiles={props.onUploadFiles}>
            {primary.label}
          </FilePickButton>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={primary.disabled || props.pending}
            title={primary.title}
            onClick={() => props.onCommand(primary.command)}
          >
            {primary.label}
          </button>
        ))}
    </header>
  );
}

const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/**
 * Chỉ báo nhỏ cạnh chip: tab này sửa được không + trạng thái lưu. Chữ đầy đủ ("Bạn đang giữ khoá chương", lý do
 * chỉ xem) nằm trong title + phần chỉ trình đọc màn hình đọc; chữ hiện ra ngắn để không chiếm topbar.
 */
function EditState(props: EditAccess) {
  const readOnly = useEditor((s) => s.readOnly);
  const save = useEditor((s) => s.save);
  if (!props.hasPages) return null;
  let view: { short: ReactNode; long: string; tone: Tone };
  if (!props.lockEnabled) view = { short: "Chỉ xem", long: "Đang dịch — sửa được khi xong", tone: "idle" };
  else if (props.lock.status === "acquiring")
    view = { short: "Đang lấy khoá…", long: "Đang lấy khoá chương…", tone: "busy" };
  else if (props.lock.status === "denied")
    view = { short: "Chỉ xem", long: `${props.lock.holderName ?? "Người khác"} đang sửa chương này`, tone: "warn" };
  else if (props.lock.status === "error")
    view = { short: "Chỉ xem", long: "Không lấy được khoá chương", tone: "danger" };
  else if (readOnly === "lock_lost")
    view = { short: "Mất khoá", long: "Mất khoá chương — đang chỉ xem", tone: "danger" };
  else if (readOnly === "recovery")
    view = { short: "Chờ khôi phục", long: "Có thay đổi chưa lưu từ phiên trước", tone: "warn" };
  else
    view = {
      short: (
        <>
          <LockIcon />
          {SAVE_LABEL[save.status]}
        </>
      ),
      long: "Bạn đang giữ khoá chương",
      tone: SAVE_TONE[save.status],
    };
  return (
    <span
      className="status cw-edit"
      data-tone={view.tone}
      role="status"
      aria-label="Khoá chương"
      title={save.error ? `${view.long} · ${save.error}` : view.long}
    >
      <span className="sr-only">{view.long} · </span>
      {view.short}
    </span>
  );
}

const READ_ONLY_TEXT: Partial<Record<Exclude<ReadOnlyReason, null>, string>> = {
  lock_lost: "Mất khoá chương (hết hạn hoặc người khác đã mở) — thay đổi chưa lưu vẫn giữ trên máy này; đang chỉ xem",
};

/**
 * Băng cảnh báo dưới thanh trên: chỉ render khi có việc người dùng phải biết/làm — người khác giữ khoá, lỗi khoá,
 * mất khoá, khôi phục thay đổi từ phiên trước, lỗi lưu. Bình thường không chiếm chỗ (trạng thái ở topbar).
 */
export function LockBand(props: {
  access: EditAccess;
  onRetryLock(): void;
  recovery: RecoveryItem[] | null;
  canRestore: boolean;
  onRecovery(accept: boolean): void;
}) {
  const readOnly = useEditor((s) => s.readOnly);
  const save = useEditor((s) => s.save);
  const { lock, lockEnabled, hasPages } = props.access;
  const items: { key: string; tone: "warn" | "danger"; body: ReactNode }[] = [];
  const retry = (
    <button type="button" className="btn-ghost" onClick={props.onRetryLock}>
      Thử lại
    </button>
  );
  if (hasPages && lockEnabled && lock.status === "denied") {
    items.push({
      key: "lock",
      tone: "warn",
      body: (
        <>
          {lock.holderName ?? "Người khác"} đang sửa chương này — bạn chỉ xem được. {retry}
        </>
      ),
    });
  } else if (hasPages && lockEnabled && lock.status === "error") {
    items.push({
      key: "lock",
      tone: "danger",
      body: (
        <>
          Không lấy được khoá chương: {lock.message} {retry}
        </>
      ),
    });
  } else if (hasPages && readOnly === "lock_lost") {
    items.push({ key: "lock", tone: "danger", body: READ_ONLY_TEXT.lock_lost });
  }
  const rec = props.recovery;
  if (rec && rec.length > 0) {
    items.push({
      key: "recovery",
      tone: "warn",
      body: (
        <>
          Có thay đổi chưa lưu từ phiên trước ở trang {rec.map((r) => r.ord + 1).join(", ")} (
          {new Date(Math.max(...rec.map((r) => r.updatedAt))).toLocaleString("vi-VN")}).{" "}
          <button
            type="button"
            className="btn-primary"
            disabled={!props.canRestore}
            title={props.canRestore ? undefined : "Cần giữ khoá chương để khôi phục"}
            onClick={() => props.onRecovery(true)}
          >
            Khôi phục
          </button>{" "}
          <button type="button" className="btn-ghost" onClick={() => props.onRecovery(false)}>
            Bỏ
          </button>
        </>
      ),
    });
  }
  // Mất khoá đã giải thích vì sao không lưu được.
  if (hasPages && save.status === "error" && readOnly !== "lock_lost") {
    items.push({ key: "save", tone: "danger", body: `Lỗi lưu: ${save.error ?? "không lưu được"}` });
  }
  if (!items.length) return null;
  return (
    <div className="cw-band" role="alert" aria-label="Cảnh báo chương">
      {items.map((it) => (
        <span key={it.key} className="status" data-tone={it.tone}>
          {it.body}
        </span>
      ))}
    </div>
  );
}
