/**
 * Logic thuần của luồng cập nhật: theo dõi tiến trình (reducer), text hiển thị, lệnh cập nhật tay, điều kiện hiện chấm.
 * Không đụng mạng / DOM để test được bằng vitest.
 */
import {
  composeUrl,
  isPrerelease,
  UPDATE_REASONS,
  type UpdateReason,
  type UpdateRun,
  type UpdateStatus,
  type UpdateStep,
} from "@mtl/shared/update";
import { type MessageKey, t } from "../../i18n/t.ts";

export const STATUS_POLL_MS = 2000;
export const CONFIG_POLL_MS = 3000;
/** Thời gian tối đa app không trả lời (khởi động lại + backup + migrate). Lúc tải image app vẫn chạy nên không tính. */
export const OFFLINE_TIMEOUT_MS = 20 * 60_000;
/** Sau khi app đã lên bản đích: chờ runner báo xong. Không thấy run của bản đích (hoặc updater không trả lời) quá ngần này thì tải lại. */
export const SETTLE_MISSING_GRACE_MS = 30_000;
/** Sau khi app đã lên bản đích mà runner vẫn `running` quá ngần này thì tải lại, không kẹt mãi. */
export const SETTLE_RUNNING_CAP_MS = 10 * 60_000;

export type Failure = {
  reason: UpdateReason;
  run: UpdateRun | null;
  /** App đã chạy bản đích nhưng runner báo lỗi ở bước cuối. */
  landed: boolean;
};

export type Tracking = {
  target: string;
  /** Đang hỏi cái gì: status của updater (app còn sống) hay /api/config (app mất kết nối). */
  source: "status" | "config";
  step: UpdateStep | null;
  /** Mốc bắt đầu mất kết nối liên tục; null khi app đang trả lời. */
  offlineSince: number | null;
  /** Mốc lần đầu thấy app chạy bản đích; null khi chưa tới. */
  landedAt: number | null;
  outcome: "running" | "done" | "failed";
  failure: Failure | null;
};

export type TrackEvent =
  | { type: "status"; status: UpdateStatus; now: number }
  | { type: "config"; version: string | null; now: number }
  | { type: "offline"; now: number };

export function startTracking(target: string, run: UpdateRun | null = null): Tracking {
  return {
    target,
    source: "status",
    step: run && run.target === target ? run.step : null,
    offlineSince: null,
    landedAt: null,
    outcome: "running",
    failure: null,
  };
}

/**
 * App đã chạy bản đích nhưng runner có thể còn bước cuối (chạy lại worker, kiểm tra): chờ run của bản đích kết thúc
 * rồi mới quyết định. Run mất / updater im quá `SETTLE_MISSING_GRACE_MS` hoặc còn `running` quá `SETTLE_RUNNING_CAP_MS`
 * thì tải lại luôn.
 */
function settle(t: Tracking, run: UpdateRun | null, now: number): Tracking {
  const landedAt = t.landedAt ?? now;
  const next: Tracking = { ...t, source: "status", offlineSince: null, landedAt, step: run?.step ?? t.step };
  if (run?.state === "succeeded") return { ...next, outcome: "done" };
  if (run?.state === "failed") {
    return { ...next, outcome: "failed", failure: { reason: run.reason ?? "internal", run, landed: true } };
  }
  const limit = run?.state === "running" ? SETTLE_RUNNING_CAP_MS : SETTLE_MISSING_GRACE_MS;
  return now - landedAt > limit ? { ...next, outcome: "done" } : next;
}

export function track(t: Tracking, ev: TrackEvent): Tracking {
  if (t.outcome !== "running") return t;
  switch (ev.type) {
    case "status": {
      const run = ev.status.updater.run;
      const mine = run !== null && run.target === t.target ? run : null;
      if (ev.status.current === t.target) return settle(t, mine, ev.now);
      if (mine?.state === "failed") {
        return {
          ...t,
          outcome: "failed",
          offlineSince: null,
          failure: { reason: mine.reason ?? "internal", run: mine, landed: false },
        };
      }
      return { ...t, source: "status", offlineSince: null, step: mine?.step ?? t.step };
    }
    case "config":
      if (ev.version === t.target) return settle(t, null, ev.now);
      // App trả lời mà vẫn bản cũ: hỏi lại status để biết lý do (hoặc runner chưa tới bước thay container).
      return { ...t, source: "status", offlineSince: null };
    case "offline": {
      const since = t.offlineSince ?? ev.now;
      if (ev.now - since > OFFLINE_TIMEOUT_MS) {
        return {
          ...t,
          source: "config",
          offlineSince: since,
          outcome: "failed",
          failure: { reason: "timeout", run: null, landed: false },
        };
      }
      return { ...t, source: "config", offlineSince: since };
    }
  }
}

export const pollInterval = (source: Tracking["source"]) => (source === "config" ? CONFIG_POLL_MS : STATUS_POLL_MS);

/** Một dòng theo bước. Không có thanh tiến độ: runner không biết phần trăm. */
export function progressText(tracking: Tracking): string {
  if (tracking.landedAt !== null) return t("update.updateModel.progressLanded");
  if (
    tracking.source === "config" ||
    tracking.step === "apply" ||
    tracking.step === "check" ||
    tracking.step === "done"
  ) {
    return t("update.updateModel.progressRestarting");
  }
  if (tracking.step === "download" || tracking.step === "pull" || tracking.step === "verify") {
    return t("update.updateModel.progressDownloading");
  }
  return t("update.updateModel.progressChecking");
}

/** `m:ss` */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Tên biến môi trường / cấu hình nằm ngoài chuỗi dịch để bản dịch không làm sai. */
const REASON_PARAMS: Partial<Record<UpdateReason, Record<string, string>>> = {
  unavailable: { setting: "MTL_UPDATER=0" },
  pinned: { setting: "MTL_TAG" },
};

const REASON_TEXT: Partial<Record<UpdateReason, MessageKey>> = {
  unavailable: "update.updateModel.reason.unavailable",
  no_socket: "update.updateModel.reason.no_socket",
  docker_too_old: "update.updateModel.reason.docker_too_old",
  pinned: "update.updateModel.reason.pinned",
  custom_compose: "update.updateModel.reason.custom_compose",
  project_not_found: "update.updateModel.reason.project_not_found",
  path_mismatch: "update.updateModel.reason.path_mismatch",
  download_failed: "update.updateModel.reason.download_failed",
  pull_failed: "update.updateModel.reason.pull_failed",
  version_mismatch: "update.updateModel.reason.version_mismatch",
  up_failed: "update.updateModel.reason.up_failed",
  timeout: "update.updateModel.reason.timeout",
  cooldown: "update.updateModel.reason.cooldown",
  invalid_compose: "update.updateModel.reason.invalid_compose",
};

/** Khoá dịch theo mã lý do; mã lạ từ server (kể cả tên thuộc tính sẵn có như `constructor`) → undefined. */
const keyFor = (table: Partial<Record<UpdateReason, MessageKey>>, reason: UpdateReason | null | undefined) =>
  reason && Object.hasOwn(table, reason) ? table[reason] : undefined;

export const reasonText = (reason: UpdateReason | null | undefined): string => {
  const key = keyFor(REASON_TEXT, reason);
  return key ? t(key, reason ? REASON_PARAMS[reason] : undefined) : t("update.updateModel.reasonFallback");
};

/** App đã chạy bản đích: câu "App chưa chạy lại được" sẽ sai, chỉ nói phần còn hỏng. */
const LANDED_TEXT: Partial<Record<UpdateReason, MessageKey>> = {
  up_failed: "update.updateModel.landedReason.up_failed",
  timeout: "update.updateModel.landedReason.timeout",
  path_mismatch: "update.updateModel.landedReason.path_mismatch",
};

export const landedReasonText = (reason: UpdateReason | null | undefined): string =>
  t(keyFor(LANDED_TEXT, reason) ?? "update.updateModel.landedReasonFallback");

/** Mã lý do trong body lỗi của API (`reason` hoặc `error`); không nhận ra → null. */
export function reasonFromBody(body: Record<string, unknown>): UpdateReason | null {
  for (const v of [body.reason, body.error]) {
    if (typeof v === "string" && (UPDATE_REASONS as readonly string[]).includes(v)) return v as UpdateReason;
  }
  return null;
}

export const isWindows = (userAgent: string) => /Windows/i.test(userAgent);

/** Windows PowerShell 5.1: `curl` là alias của Invoke-WebRequest → phải gọi `curl.exe`. */
export const curlLine = (userAgent: string) =>
  `${isWindows(userAgent) ? "curl.exe" : "curl"} -fsSLO ${composeUrl("main")}`;

/** Lệnh cập nhật tay, từng dòng một. */
export const manualCommands = (userAgent: string): string[] => [
  curlLine(userAgent),
  "docker compose pull",
  "docker compose up -d",
];

/** Đang ghim bản chính thức thì không cập nhật đè; đích là rc thì vẫn cho. */
const blockedByPin = (s: UpdateStatus) => s.pinned_tag !== null && s.latest !== null && !isPrerelease(s.latest.version);

/** Bản mới đang được đề xuất cho người dùng (có link + nút), không tính ghim. */
export const offeredVersion = (s: UpdateStatus | undefined): string | null =>
  s?.update_available && s.latest ? s.latest.version : null;

/** Chấm trên avatar: có bản mới, chưa xem, và không phải ghim-bản-chính-thức. */
/** Có mục "Kiểm tra bản mới" không: chỉ khi app hỏi GitHub được (không phải bản dev / đã tắt) và chưa có bản mới để mời. */
export const canCheckNow = (s: UpdateStatus | undefined): boolean =>
  !!s && (s.check === "ok" || s.check === "error") && !offeredVersion(s) && s.updater.run?.state !== "running";

/** Kết quả sau khi bấm "Kiểm tra bản mới"; null khi có bản mới (menu đã hiện "Có bản mới …"). */
export function checkNowText(s: UpdateStatus): string | null {
  if (s.check === "error") return t("update.updateModel.checkError");
  if (offeredVersion(s)) return null;
  return s.current === "dev"
    ? t("update.updateModel.upToDate")
    : t("update.updateModel.upToDateVersion", { version: s.current });
}

export const showDot = (s: UpdateStatus | undefined, seen: string | null): boolean => {
  const v = offeredVersion(s);
  return v !== null && s !== undefined && v !== seen && !blockedByPin(s);
};

/** Nút "Cập nhật ngay" (true) hay "Cách cập nhật" (false). */
export const canUpdateInApp = (s: UpdateStatus): boolean => s.updater.ready && !blockedByPin(s);

/** Lý do hiện ở hộp "Cách cập nhật". */
export const manualReason = (s: UpdateStatus): UpdateReason | null => (blockedByPin(s) ? "pinned" : s.updater.reason);

/** Lần cập nhật gần nhất lỗi và app chưa lên bản đích. */
export const failedRun = (s: UpdateStatus | undefined): UpdateRun | null => {
  const run = s?.updater.run;
  return run && run.state === "failed" && s.current !== run.target ? run : null;
};

/** Tên container runner để xem log. */
export const runnerLogName = (project: string | null) => `${project ?? "mtl-local"}-update`;
