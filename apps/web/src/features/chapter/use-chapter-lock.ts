/**
 * Giữ khoá chương khi mở editor. Khoá giữ theo tab (header `x-tab-id`, xem lib/api.ts): chương đang mở sửa ở tab
 * khác → tab này chỉ xem. Server ép khoá cho mọi ghi nội dung chương; khoá hết hạn sau 15 phút không heartbeat. Chỉ
 * heartbeat khi người dùng còn thao tác — rời máy 15 phút thì khoá tự nhả cho tab khác.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, tabId } from "../../lib/api.ts";
import { chapterKeys, lockChapter, unlockChapter } from "./api.ts";

export const HEARTBEAT_MS = 60_000;
/** Ngưỡng coi là rời máy — nhỏ hơn TTL khoá server (15') để không gia hạn khoá cho phiên bỏ quên. */
export const IDLE_MS = 14 * 60_000;

export type LockState =
  | { status: "acquiring" }
  | { status: "held"; expiresAt: string }
  | { status: "denied" }
  | { status: "error"; message: string };

/**
 * Mọi lock/unlock của tab đi tuần tự: StrictMode hoặc đổi chương tạo chuỗi unlock(cũ) → lock(mới); chạy
 * song song thì unlock có thể tới server SAU lock và nhả mất khoá đang hiển thị là "đang giữ".
 * Export để thao tác cần khoá (lượt lưu cuối của editor) xếp hàng TRƯỚC lệnh nhả khoá khi unmount.
 */
let lockChain: Promise<unknown> = Promise.resolve();
export function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = lockChain.then(op, op);
  lockChain = run.catch(() => undefined);
  return run;
}

export function useChapterLock(chapterId: string, enabled = true) {
  const qc = useQueryClient();
  const [state, setState] = useState<LockState>({ status: "acquiring" });
  const lastActivity = useRef(Date.now());

  /** false sau cleanup — response muộn của lần mount cũ không ghi đè state của chương mới. */
  const live = useRef(false);

  const acquire = useCallback(async () => {
    try {
      const r = await serial(() => lockChapter(chapterId));
      if (live.current) setState({ status: "held", expiresAt: r.expires_at });
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 423) {
        setState({ status: "denied" });
      } else setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      void qc.invalidateQueries({ queryKey: chapterKeys.detail(chapterId) });
    }
  }, [chapterId, qc]);

  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    setState({ status: "acquiring" });
    void acquire();
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const ev of events) addEventListener(ev, mark, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_MS) void acquire();
    }, HEARTBEAT_MS);
    // Đóng tab: nhả khoá bằng request keepalive (unmount thường không kịp chạy). Đúng tab id → chỉ nhả khoá của tab này.
    const onHide = () => {
      void fetch(`/api/chapters/${chapterId}/lock`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-tab-id": tabId() },
        keepalive: true,
      });
    };
    addEventListener("pagehide", onHide);
    return () => {
      for (const ev of events) removeEventListener(ev, mark);
      removeEventListener("pagehide", onHide);
      clearInterval(timer);
      live.current = false;
      void serial(() => unlockChapter(chapterId)).catch(() => undefined);
    };
  }, [chapterId, enabled, acquire]);

  return { state, retry: acquire };
}
