/**
 * Thanh trên màn chương (tối đa 8 mục): ‹ series, "Ch.12" (bấm → đổi series / số chương / ngôn ngữ), chip trạng thái
 * chương (nút: có trang cần xem → nhảy tới trang đó, không thì mở Hoạt động; chỗ duy nhất nói chương đang ở đâu),
 * chỉ báo sửa/lưu (chỉ hiện khi đang lưu / lỗi / chưa lưu / chỉ xem) · Hoàn tác / Làm lại · Gốc · menu ⋯ (Chia đôi,
 * Xuất, Dịch lại cả chương, Hoạt động, Phím tắt) · nút chính theo trạng thái (primary-action.ts; đang chạy = Huỷ,
 * "Xuất" mở menu ngay dưới nút). Thanh 2px ở đáy cho tiến độ chương đang chạy.
 * Dưới nó là băng cảnh báo — chỉ hiện khi người dùng phải biết/làm gì (khoá bị giữ/mất/lỗi, khôi phục, lỗi lưu, chờ AI).
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LockState } from "../chapter/use-chapter-lock.ts";
import { PAGE_BUSY_SAVE_TEXT } from "../editor/save.ts";
import { type SaveStatus, useEditor } from "../editor/store.ts";
import type { RecoveryItem } from "../editor/use-chapter-session.ts";
import type { Series } from "../series/api.ts";
import { FilePickButton } from "../upload/drop-zone.tsx";
import type { ChapterDetail } from "./api.ts";
import { ChapterMetaPopover } from "./chapter-meta-popover.tsx";
import { MoreMenu, OriginalToggle } from "./more-menu.tsx";
import type { ChapterCommand, PrimaryAction } from "./primary-action.ts";
import type { Tone } from "./status.ts";
import { RedoIcon, UndoIcon } from "./tool-icons.tsx";

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
  seriesId: string;
  /** Chi tiết series (ô ngôn ngữ trong popover tên chương); chưa tải → popover không có ô đó. */
  series: Series | undefined;
  detail: ChapterDetail | undefined;
  /** Chip trạng thái chương (status.ts chapterChip + chipWithActivity). */
  chip: { label: string; tone: Tone } | null;
  /** Bấm chip: true = nhảy tới trang cần xem kế tiếp, false = mở Hoạt động (do `onChip` làm). */
  chipJumps: boolean;
  onChip(): void;
  /** Tiến độ chương đang chạy (status.ts chapterProgress): số 0..1, null = chưa đo được, undefined = không vẽ. */
  progress: number | null | undefined;
  access: EditAccess;
  primary: PrimaryAction | null;
  pending: boolean;
  /** `opener` = nút vừa bấm (menu Xuất căn theo nút đó và trả focus về nó). */
  onCommand(cmd: ChapterCommand, opener?: HTMLElement): void;
  onUploadFiles(files: File[]): void;
  /** Lưu xong rồi mới rời (giữ href cho mở tab mới). */
  onBack(): void;
  /** Đã chuyển chương sang series khác → điều hướng URL mới. */
  onMoved(seriesId: string): void;
  /** Số việc đang chạy (upload, job chương, xuất) — ghi cạnh mục Hoạt động của menu ⋯. */
  activityCount: number;
  onActivity(): void;
  onHelp(): void;
  /** Hoàn tác / Làm lại như phím Cmd+Z (bước cuối là lượt sửa nhiều trang thì hoàn tác cả lượt). */
  onUndo(): void;
  onRedo(): void;
}) {
  const { detail, primary, chip } = props;

  return (
    <header className="cw-top">
      <Link
        to="/s/$seriesId"
        params={{ seriesId: props.seriesId }}
        className="cw-back"
        title={detail?.series.title}
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
        <span className="cw-back-name">{detail?.series.title ?? "Series"}</span>
      </Link>
      <ChapterMetaPopover detail={detail} series={props.series} onMoved={props.onMoved} />
      <span className="cw-state">
        {/* Luôn render vùng live (rỗng khi chưa tải) để trình đọc màn hình báo được lần đổi đầu tiên. */}
        <span className="cw-chip" role="status" aria-live="polite" aria-label="Trạng thái chương">
          {chip && (
            <button
              type="button"
              className="cw-chip-btn"
              aria-label={`${chip.label} — ${props.chipJumps ? "nhảy tới trang cần xem" : "mở Hoạt động"}`}
              title={props.chipJumps ? "Nhảy tới trang cần xem tiếp theo" : "Mở Hoạt động"}
              onClick={props.onChip}
            >
              <span className="status" data-tone={chip.tone}>
                <span className="cw-chip-label">{chip.label}</span>
              </span>
            </button>
          )}
        </span>
        <EditState {...props.access} />
      </span>
      <span className="spacer" />
      <UndoRedo onUndo={props.onUndo} onRedo={props.onRedo} />
      <OriginalToggle />
      <MoreMenu
        commands={primary?.menu ?? []}
        pending={props.pending}
        onCommand={props.onCommand}
        onActivity={props.onActivity}
        activityCount={props.activityCount}
        onHelp={props.onHelp}
      />
      {primary &&
        (primary.command === "upload" ? (
          <FilePickButton className="btn-primary" onFiles={props.onUploadFiles}>
            {primary.label}
          </FilePickButton>
        ) : (
          <button
            type="button"
            className={primary.command === "cancel" ? "btn-danger" : "btn-primary"}
            disabled={primary.disabled || props.pending}
            title={primary.title}
            onClick={(e) => props.onCommand(primary.command, e.currentTarget)}
          >
            {primary.label}
          </button>
        ))}
      {props.progress !== undefined && (
        <span
          className="cw-progress"
          data-indeterminate={props.progress === null}
          aria-hidden="true"
          style={props.progress === null ? undefined : { width: `${Math.round(props.progress * 100)}%` }}
        />
      )}
    </header>
  );
}

/** Hoàn tác / Làm lại (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) — tắt khi hết lịch sử hoặc đang chỉ xem. */
function UndoRedo({ onUndo, onRedo }: { onUndo(): void; onRedo(): void }) {
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const readOnly = useEditor((s) => !!s.readOnly);
  return (
    <span className="cw-icons">
      <button
        type="button"
        className="icon-btn"
        aria-label="Hoàn tác (Ctrl+Z)"
        title="Hoàn tác (Ctrl+Z)"
        disabled={!canUndo || readOnly}
        onClick={onUndo}
      >
        <UndoIcon size={18} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Làm lại (Ctrl+Shift+Z)"
        title="Làm lại (Ctrl+Shift+Z)"
        disabled={!canRedo || readOnly}
        onClick={onRedo}
      >
        <RedoIcon size={18} />
      </button>
    </span>
  );
}

const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/**
 * Chỉ báo nhỏ cạnh chip: tab này sửa được không + trạng thái lưu. Lúc bình thường (giữ khoá, đã lưu) không hiện gì
 * — chỉ hiện khi đang lưu, lỗi lưu, chưa lưu, hoặc chỉ xem. Vùng `role="status"` luôn có trong DOM (rỗng hiển thị,
 * chỉ còn chữ cho trình đọc màn hình) để lần đổi sau vẫn được đọc; chữ đầy đủ nằm ở title + phần chỉ trình đọc.
 */
function EditState(props: EditAccess) {
  const readOnly = useEditor((s) => s.readOnly);
  const save = useEditor((s) => s.save);
  if (!props.hasPages) return <span className="cw-edit-live" role="status" aria-label="Khoá chương" />;
  let view: { short: ReactNode; long: string; tone: Tone } | null = null;
  if (!props.lockEnabled) view = { short: "Chỉ xem", long: "Đang cắt trang — sửa được khi xong", tone: "idle" };
  else if (props.lock.status === "acquiring")
    view = { short: "Đang lấy khoá…", long: "Đang lấy khoá chương…", tone: "busy" };
  else if (props.lock.status === "denied")
    view = { short: "Chỉ xem", long: "Chương đang mở ở tab khác — chỉ xem ở tab này", tone: "warn" };
  else if (props.lock.status === "error")
    view = { short: "Chỉ xem", long: "Không lấy được khoá chương", tone: "danger" };
  else if (readOnly === "lock_lost")
    view = { short: "Mất khoá", long: "Mất khoá chương — đang chỉ xem", tone: "danger" };
  else if (readOnly === "recovery")
    view = { short: "Chờ khôi phục", long: "Có thay đổi chưa lưu từ phiên trước", tone: "warn" };
  else if (readOnly === "page_busy")
    view =
      save.status === "saved"
        ? { short: "Chỉ xem", long: "Trang này đang dịch — sửa được khi xong", tone: "idle" }
        : { short: "Chờ lưu", long: PAGE_BUSY_SAVE_TEXT, tone: "warn" };
  else if (save.status !== "saved")
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
  if (!view)
    return (
      <span className="cw-edit-live" role="status" aria-label="Khoá chương">
        <span className="sr-only">Bạn đang giữ khoá chương · {SAVE_LABEL[save.status]}</span>
      </span>
    );
  return (
    <span className="cw-edit-live" role="status" aria-label="Khoá chương">
      <span
        className="status cw-edit"
        data-tone={view.tone}
        title={save.error && save.error !== view.long ? `${view.long} · ${save.error}` : view.long}
      >
        <span className="sr-only">{view.long} · </span>
        {view.short}
      </span>
    </span>
  );
}

/** Lý do dài của băng cảnh báo — nằm trong tooltip; băng chỉ hiện câu ngắn + nút. */
const LOCK_LOST_WHY =
  "Mất khoá chương (hết hạn hoặc tab khác đã mở) — thay đổi chưa lưu vẫn giữ trên máy này; đang chỉ xem";
const LOCK_DENIED_WHY = "Tab khác đang giữ khoá chương nên tab này chỉ xem được. Đóng tab kia rồi bấm Thử lại.";

/**
 * Băng cảnh báo dưới thanh trên: chỉ render khi có việc người dùng phải biết/làm — tab khác giữ khoá, lỗi khoá,
 * mất khoá, khôi phục thay đổi từ phiên trước, lỗi lưu, trang đang chờ AI tự thử lại (hết hạn mức/quá tải). Bình
 * thường không chiếm chỗ (trạng thái ở topbar).
 */
export function LockBand(props: {
  access: EditAccess;
  onRetryLock(): void;
  recovery: RecoveryItem[] | null;
  canRestore: boolean;
  onRecovery(accept: boolean): void;
  /** Trang chờ AI thử lại (job-error.ts): câu ngắn cho băng, câu đầy đủ cho tooltip; null = không có. */
  aiWait: { short: string; long: string } | null;
  /** Số xung đột khi lưu đang bị giấu (panel thu) — đổi trang là mất danh sách, nên báo ở băng. */
  hiddenConflicts: number;
  onShowConflicts(): void;
}) {
  const readOnly = useEditor((s) => s.readOnly);
  const save = useEditor((s) => s.save);
  const { lock, lockEnabled, hasPages } = props.access;
  const items: { key: string; tone: "warn" | "danger"; body: ReactNode; why?: string }[] = [];
  const retry = (
    <button type="button" className="btn-ghost" onClick={props.onRetryLock}>
      Thử lại
    </button>
  );
  if (hasPages && lockEnabled && lock.status === "denied") {
    items.push({
      key: "lock",
      tone: "warn",
      body: <>Chương đang mở ở tab khác {retry}</>,
      why: LOCK_DENIED_WHY,
    });
  } else if (hasPages && lockEnabled && lock.status === "error") {
    items.push({
      key: "lock",
      tone: "danger",
      body: <>Không lấy được khoá chương {retry}</>,
      why: lock.message,
    });
  } else if (hasPages && readOnly === "lock_lost") {
    items.push({ key: "lock", tone: "danger", body: "Mất khoá chương, đang chỉ xem", why: LOCK_LOST_WHY });
  } else if (hasPages && readOnly === "page_busy" && save.status !== "saved") {
    items.push({ key: "lock", tone: "warn", body: "Trang đang dịch, bản sửa chờ lưu", why: PAGE_BUSY_SAVE_TEXT });
  }
  const rec = props.recovery;
  if (rec && rec.length > 0) {
    items.push({
      key: "recovery",
      tone: "warn",
      why: `Thay đổi chưa lưu từ phiên trước, lúc ${new Date(Math.max(...rec.map((r) => r.updatedAt))).toLocaleString("vi-VN")}.`,
      body: (
        <>
          Thay đổi chưa lưu ở trang {rec.map((r) => r.ord + 1).join(", ")}{" "}
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
    items.push({ key: "save", tone: "danger", body: "Lỗi lưu, chưa ghi được", why: save.error ?? "Không lưu được" });
  }
  if (props.aiWait) items.push({ key: "ai", tone: "warn", body: props.aiWait.short, why: props.aiWait.long });
  if (props.hiddenConflicts > 0) {
    items.push({
      key: "conflicts",
      tone: "danger",
      why: "Các thay đổi này xung đột với bản đã lưu trên máy chủ. Đổi trang sẽ mất danh sách.",
      body: (
        <>
          {props.hiddenConflicts} thay đổi chưa áp được{" "}
          <button type="button" className="btn-ghost" onClick={props.onShowConflicts}>
            Xem
          </button>
        </>
      ),
    });
  }
  if (!items.length) return null;
  return (
    <div className="cw-band" role="alert" aria-label="Cảnh báo chương">
      {items.map((it) => (
        <span key={it.key} className="status" data-tone={it.tone} title={it.why}>
          {it.body}
          {it.why && <span className="sr-only"> — {it.why}</span>}
        </span>
      ))}
    </div>
  );
}
