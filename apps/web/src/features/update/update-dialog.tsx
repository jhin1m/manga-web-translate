/**
 * Hộp cập nhật (Drawer modal): xác nhận → đang chạy → lỗi / xong, và "Cách cập nhật" (chỉ lệnh tay).
 * Đang gửi yêu cầu hoặc đang chạy thì không đóng được (Esc, scrim, nút Đóng đều vô hiệu): đóng giữa chừng không dừng
 * được runner, và hộp đã gỡ thì không còn gì theo dõi.
 */
import type { UpdateRun, UpdateStatus } from "@mtl/shared/update";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Drawer } from "../../app/drawer.tsx";
import { ApiError } from "../../lib/api.ts";
import { pollStatus, pollVersion, startUpdate, UPDATE_STATUS_KEY } from "./api.ts";
import { ManualUpdate } from "./manual-update.tsx";
import {
  type Failure,
  formatElapsed,
  landedReasonText,
  manualReason,
  pollInterval,
  progressText,
  reasonFromBody,
  reasonText,
  runnerLogName,
  startTracking,
  type Tracking,
  track,
} from "./update-model.ts";
import "./update.css";

export type UpdateDialogMode = "confirm" | "manual" | "running" | "error";

const RELOAD_DELAY_MS = 800;
const noop = () => undefined;

/** Run đang chạy của đúng bản đích theo status mới nhất; hỏi lỗi / không có → null. */
async function runningFor(version: string): Promise<UpdateRun | null> {
  try {
    const run = (await pollStatus()).updater.run;
    return run?.state === "running" && run.target === version ? run : null;
  } catch {
    return null;
  }
}

export function UpdateDialog(props: {
  status: UpdateStatus;
  mode: UpdateDialogMode;
  /** Bản đích: latest (xác nhận / cách cập nhật) hoặc `run.target` (đang chạy / lỗi). */
  version: string;
  onClose(): void;
}) {
  const { status, version } = props;
  const run = status.updater.run;
  const qc = useQueryClient();
  const [mode, setMode] = useState<UpdateDialogMode | "stale">(props.mode);
  const [pending, setPending] = useState(false);
  const [postFailure, setPostFailure] = useState<Failure | null>(
    props.mode === "error" ? { reason: run?.reason ?? "internal", run, landed: false } : null,
  );
  const [tracking, setTracking] = useState<Tracking | null>(
    props.mode === "running" ? startTracking(version, run) : null,
  );
  const [startedAt, setStartedAt] = useState(() => {
    const t = run && props.mode === "running" ? Date.parse(run.started_at) : Number.NaN;
    return Number.isNaN(t) ? Date.now() : t;
  });
  const [now, setNow] = useState(() => Date.now());

  const failure = postFailure ?? (tracking?.outcome === "failed" ? tracking.failure : null);
  const running = !failure && tracking?.outcome === "running";
  const done = !failure && tracking?.outcome === "done";

  // Theo dõi: app còn trả lời → status mỗi 2s; mất kết nối → /api/config mỗi 3s.
  const source = tracking?.source;
  useEffect(() => {
    if (!running || !source) return;
    let busy = false;
    const offline = () => setTracking((t) => t && track(t, { type: "offline", now: Date.now() }));
    const id = setInterval(() => {
      if (busy) return;
      busy = true;
      const probe =
        source === "status"
          ? pollStatus().then((s) => setTracking((t) => t && track(t, { type: "status", status: s, now: Date.now() })))
          : pollVersion().then((v) =>
              setTracking((t) => t && track(t, { type: "config", version: v, now: Date.now() })),
            );
      probe.catch(offline).finally(() => {
        busy = false;
      });
    }, pollInterval(source));
    return () => clearInterval(id);
  }, [running, source]);

  // Đồng hồ `m:ss`.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Xong → hiện một nhịp rồi tải lại để lấy web mới.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(id);
  }, [done]);

  const begin = (r: UpdateRun | null) => {
    setStartedAt(r ? Date.parse(r.started_at) || Date.now() : Date.now());
    setTracking(startTracking(version, r));
    setMode("running");
  };

  const submit = async () => {
    setPending(true);
    try {
      begin((await startUpdate(version)).run);
    } catch (e) {
      const reason = e instanceof ApiError ? reasonFromBody(e.body) : null;
      // 429 (cooldown) đi tiếp xuống bước hỏi lại status: chỉ theo dõi khi thật sự có run đang chạy, không thì lỗi
      // của lần trước sẽ hiện lại như thể là lỗi của lần này.
      if (e instanceof ApiError && e.status === 409 && reason === "busy") begin(null);
      else if (e instanceof ApiError && e.status === 409 && reason === "stale") {
        void qc.invalidateQueries({ queryKey: UPDATE_STATUS_KEY });
        setMode("stale");
      } else {
        // POST lỗi (kể cả timeout) nhưng updater có thể đã tạo runner: hỏi lại status một lần trước khi báo lỗi.
        const started = await runningFor(version);
        if (started) begin(started);
        else setPostFailure({ reason: reason ?? "internal", run: null, landed: false });
      }
    } finally {
      setPending(false);
    }
  };

  const pinned = status.pinned_tag !== null;

  if (running || done) {
    return (
      <Drawer variant="modal" title={`Cập nhật lên v${version}`} onClose={noop}>
        <div className="update-running">
          {/* Vùng live chỉ chứa câu theo bước; đồng hồ nằm ngoài để trình đọc màn hình không đọc lại mỗi giây. */}
          <p role="status">{done || !tracking ? `Đã cập nhật lên v${version}` : progressText(tracking)}</p>
          {!done && <p className="muted small">{formatElapsed(now - startedAt)}</p>}
        </div>
      </Drawer>
    );
  }

  if (failure) {
    const tail = failure.run?.log_tail ?? [];
    return (
      <Drawer
        variant="modal"
        title={failure.landed ? `Đã lên v${version}, bước cuối lỗi` : `Cập nhật v${version} lỗi`}
        // App đã chạy bản mới: đóng hộp thì tải lại để web dùng bundle mới, không để trang cũ chạy tiếp.
        onClose={failure.landed ? () => location.reload() : props.onClose}
      >
        {failure.landed && (
          <p className="notice danger">
            App đã chạy bản v{version}, nhưng cập nhật kết thúc với lỗi ở bước cuối (worker hoặc dữ liệu có thể chưa
            đúng).
          </p>
        )}
        <p className={failure.landed ? "small" : "notice danger"}>
          {failure.landed ? landedReasonText(failure.reason) : reasonText(failure.reason)}
        </p>
        <p className="small">
          Xem log: <code>docker logs {runnerLogName(status.updater.project)}</code>
        </p>
        {tail.length > 0 && (
          <details className="update-detail">
            <summary>Chi tiết kỹ thuật</summary>
            <pre>{tail.join("\n")}</pre>
          </details>
        )}
        <ManualUpdate pinned={pinned} />
      </Drawer>
    );
  }

  if (mode === "stale") {
    return (
      <Drawer variant="modal" title="Cập nhật" onClose={props.onClose}>
        <p className="notice info">Đã có bản khác, mở lại menu.</p>
      </Drawer>
    );
  }

  if (mode === "manual") {
    const reason = manualReason(status);
    return (
      <Drawer variant="modal" title="Cách cập nhật" onClose={props.onClose}>
        {reason && <p className="notice info">{reasonText(reason)}</p>}
        <ManualUpdate pinned={pinned} />
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="modal"
      title={`Cập nhật lên v${version}`}
      onClose={pending ? noop : props.onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={props.onClose} disabled={pending}>
            Huỷ
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={pending}>
            {pending ? "Đang gửi…" : "Cập nhật"}
          </button>
        </>
      }
    >
      {pending && (
        <p className="update-pending muted small" role="status">
          Đang gửi yêu cầu cập nhật…
        </p>
      )}
      <ul className="update-lines">
        <li>App dừng vài phút để sao lưu dữ liệu rồi cập nhật.</li>
        <li>Việc đang chạy sẽ dừng (chờ tối đa 90 giây), trang đang xử lý có thể phải chạy lại.</li>
        <li>Sau khi cập nhật không quay lại bản cũ được.</li>
      </ul>
    </Drawer>
  );
}
