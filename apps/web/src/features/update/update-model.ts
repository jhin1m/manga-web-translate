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
export function progressText(t: Tracking): string {
  if (t.landedAt !== null) return "App đã chạy bản mới, đang hoàn tất bước cuối…";
  if (t.source === "config" || t.step === "apply" || t.step === "check" || t.step === "done") {
    return "Đang khởi động lại: sao lưu dữ liệu, cập nhật, chạy lại worker…";
  }
  if (t.step === "download" || t.step === "pull" || t.step === "verify") {
    return "Đang tải bản mới. Trong lúc này app vẫn chạy.";
  }
  return "Đang kiểm tra…";
}

/** `m:ss` */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const REASON_TEXT: Partial<Record<UpdateReason, string>> = {
  unavailable: "Bản cài này chưa có bộ cập nhật (file compose cũ, hoặc đã tắt bằng MTL_UPDATER=0).",
  no_socket: "Bộ cập nhật không truy cập được Docker (Docker rootless hoặc thiếu socket).",
  docker_too_old: "Docker quá cũ cho bộ cập nhật. Cập nhật Docker Desktop, hoặc cập nhật tay.",
  pinned: "Bạn đang ghim phiên bản bằng MTL_TAG.",
  custom_compose: "Bạn dùng file compose tuỳ chỉnh hoặc file override.",
  project_not_found: "Không xác định chắc được thư mục dữ liệu, nên dừng để an toàn.",
  path_mismatch: "Không xác định chắc được thư mục dữ liệu, nên dừng để an toàn.",
  download_failed: "Không tải được bản mới. Kiểm tra mạng rồi thử lại. App vẫn chạy bản cũ.",
  pull_failed: "Không tải được bản mới. Kiểm tra mạng rồi thử lại. App vẫn chạy bản cũ.",
  version_mismatch: "Bản mới vừa phát hành chưa sẵn sàng. Thử lại sau vài phút.",
  up_failed: "App chưa chạy lại được. Xem log app và mục Sự cố của hướng dẫn.",
  timeout: "App chưa chạy lại được. Xem log app và mục Sự cố của hướng dẫn.",
  cooldown: "Vừa thử cập nhật. Đợi một phút rồi thử lại.",
  invalid_compose: "Bản mới đổi cấu trúc file compose nên phải cập nhật tay. Xem ghi chú phát hành.",
};

export const reasonText = (reason: UpdateReason | null | undefined): string =>
  (reason ? REASON_TEXT[reason] : undefined) ?? "Cập nhật lỗi.";

/** App đã chạy bản đích: câu "App chưa chạy lại được" sẽ sai, chỉ nói phần còn hỏng. */
const LANDED_TEXT: Partial<Record<UpdateReason, string>> = {
  up_failed: "Worker hoặc tiến trình nền chưa chạy lại được. Xem log và mục Sự cố của hướng dẫn.",
  timeout: "Worker hoặc tiến trình nền chưa chạy lại được. Xem log và mục Sự cố của hướng dẫn.",
  path_mismatch: "Thư mục dữ liệu sau cập nhật khác trước. Xem mục Sự cố của hướng dẫn trước khi dùng tiếp.",
};

export const landedReasonText = (reason: UpdateReason | null | undefined): string =>
  (reason ? LANDED_TEXT[reason] : undefined) ?? "Xem log và mục Sự cố của hướng dẫn.";

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
