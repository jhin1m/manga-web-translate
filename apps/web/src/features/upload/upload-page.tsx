/**
 * Upload chương: chọn ảnh rời / ZIP (giải nén ở client) → sắp thứ tự (tên tự nhiên + kéo thả) → tạo chương +
 * presigned POST → upload song song 4 file, thử lại từng file → commit (server kiểm HEAD + magic bytes).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { commitChapter, REJECT_REASON, type Rejected } from "../chapter/api.ts";
import { fetchSeries, nextChapterNumber, seriesKeys } from "../series/api.ts";
import { createChapter, type PresignedTarget, presignAgain } from "./api.ts";
import { collectPages, listProblems, MAX_FILES, type PageFile } from "./files.ts";
import { naturalSortBy } from "./natural-sort.ts";
import { type ItemState, postToPresigned, runUploadQueue } from "./upload-queue.ts";

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

type Phase = "select" | "uploading" | "has_failed" | "committing" | "rejected";

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export function UploadPage({ ws, seriesId }: { ws: string; seriesId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seriesQ = useQuery({ queryKey: seriesKeys.detail(ws, seriesId), queryFn: () => fetchSeries(ws, seriesId) });
  const [pages, setPages] = useState<PageFile[]>([]);
  const [number, setNumber] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("select");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const chapter = useRef<{ id: string; targets: Map<string, PresignedTarget> } | null>(null);
  const dragFrom = useRef<number | null>(null);

  const chapterNumber = number ?? (seriesQ.data ? nextChapterNumber(seriesQ.data.chapters) : "");
  const problems = useMemo(() => listProblems(pages), [pages]);
  const totalBytes = pages.reduce((s, p) => s + p.size, 0);
  const doneCount = pages.filter((p) => states[p.key]?.status === "done").length;
  const failedPages = pages.filter((p) => states[p.key]?.status === "failed");
  const uploadedBytes = pages.reduce((s, p) => s + Math.min(p.size, states[p.key]?.loaded ?? 0), 0);
  const locked = phase !== "select";

  async function addFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    setError(null);
    setReading(true);
    try {
      const more = await collectPages([...list]);
      setPages((cur) => [...cur, ...more]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setReading(false);
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= pages.length || from === to) return;
    setPages((cur) => {
      const next = [...cur];
      const [it] = next.splice(from, 1);
      if (it) next.splice(to, 0, it);
      return next;
    });
  }

  async function uploadAll(items: PageFile[]) {
    const ch = chapter.current;
    if (!ch) return;
    setPhase("uploading");
    const failed = await runUploadQueue(items, {
      concurrency: CONCURRENCY,
      maxAttempts: MAX_ATTEMPTS,
      backoff: (n) => 1000 * 2 ** (n - 2),
      onChange: (p, s) => setStates((cur) => ({ ...cur, [p.key]: s })),
      upload: async (p, attempt, onProgress) => {
        let target = ch.targets.get(p.key);
        if (!target) throw new Error("thiếu presigned target");
        // Lần thử lại: ký lại (policy có thể đã hết hạn sau khi mất mạng lâu).
        if (attempt > 1 || Date.parse(target.expires_at) - Date.now() < 60_000) {
          const [fresh] = (await presignAgain(ws, ch.id, [target.id])).files;
          if (fresh) {
            target = fresh;
            ch.targets.set(p.key, fresh);
          }
        }
        await postToPresigned(target, p.blob, onProgress);
      },
    });
    if (failed.length) setPhase("has_failed");
    else await commit();
  }

  async function start() {
    setError(null);
    try {
      const res = await createChapter(ws, {
        series_id: seriesId,
        number: chapterNumber,
        title,
        files: pages.map((p) => ({ name: p.name, content_type: p.contentType ?? "", bytes: p.size })),
      });
      const targets = new Map<string, PresignedTarget>();
      for (const f of res.files) {
        const p = pages[f.ord];
        if (p) targets.set(p.key, f);
      }
      chapter.current = { id: res.chapter.id, targets };
      void qc.invalidateQueries({ queryKey: seriesKeys.detail(ws, seriesId) });
      await uploadAll(pages);
    } catch (e) {
      setError(errorMessage(e));
      setPhase(chapter.current ? "has_failed" : "select");
    }
  }

  async function commit() {
    const ch = chapter.current;
    if (!ch) return;
    setPhase("committing");
    try {
      const r = await commitChapter(ws, ch.id);
      if (r.rejected.length) {
        setRejected(describeRejected(r.rejected));
        setPhase("rejected");
        return;
      }
      void navigate({ to: "/w/$ws/series/$seriesId/chapters/$chapterId", params: { ws, seriesId, chapterId: ch.id } });
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body.rejected)) {
        setRejected(describeRejected(e.body.rejected as Rejected[]));
      }
      setError(errorMessage(e));
      setPhase("has_failed");
    }
  }

  function describeRejected(list: Rejected[]) {
    const byId = new Map([...(chapter.current?.targets.entries() ?? [])].map(([key, t]) => [t.id, key]));
    return list.map((r) => ({
      name: pages.find((p) => p.key === byId.get(r.id))?.name ?? `#${r.ord + 1}`,
      reason: REJECT_REASON[r.reason],
    }));
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (!locked) void addFiles(e.dataTransfer.files);
  };

  return (
    <div className="page page-narrow">
      <div className="crumbs">
        <Link to="/w/$ws/series" params={{ ws }}>
          Series
        </Link>{" "}
        /{" "}
        <Link to="/w/$ws/series/$seriesId" params={{ ws, seriesId }}>
          {seriesQ.data?.title ?? "…"}
        </Link>
      </div>
      <div className="page-head">
        <h1>Upload chương</h1>
      </div>

      <div className="grid-2">
        <div>
          <label htmlFor="ch-number">Số chương</label>
          <input
            id="ch-number"
            inputMode="decimal"
            value={chapterNumber}
            disabled={locked}
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ch-title">Tên chương (tuỳ chọn)</label>
          <input id="ch-title" value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>

      {!locked && (
        // biome-ignore lint/a11y/noStaticElementInteractions: vùng thả file bổ trợ; nút chọn file bên trong dùng được bằng bàn phím.
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px dashed var(--c-line-strong)",
            borderRadius: "var(--radius)",
            background: "var(--c-surface)",
          }}
        >
          <div className="row">
            <label className="btn" style={{ margin: 0, color: "inherit" }}>
              Chọn ảnh hoặc ZIP…
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,.zip,application/zip"
                style={{ display: "none" }}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="muted small">
              hoặc kéo thả vào đây · png/jpg/webp ≤ 30MB/file · tối đa {MAX_FILES} file · ZIP giải nén ngay trên máy
            </span>
            {reading && (
              <span className="status" data-tone="busy">
                Đang đọc file…
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className="notice danger">{error}</p>}
      {problems.map((p) => (
        <p key={p} className="notice danger">
          {p}
        </p>
      ))}
      {rejected.length > 0 && (
        <div className="notice danger">
          Server loại {rejected.length} file:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {rejected.map((r) => (
              <li key={r.name}>
                <span className="mono">{r.name}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pages.length > 0 && (
        <div className="section">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2>
              {pages.length} trang · {fmtBytes(totalBytes)}
            </h2>
            {phase !== "select" && (
              <span className="muted small">
                Đã upload {doneCount}/{pages.length} · {fmtBytes(uploadedBytes)}
              </span>
            )}
            <span className="spacer" />
            {phase === "select" && (
              <>
                <button type="button" onClick={() => setPages((c) => naturalSortBy(c, (p) => p.name))}>
                  Sắp theo tên
                </button>
                <button type="button" onClick={() => setPages([])}>
                  Xoá hết
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={problems.length > 0 || !chapterNumber || reading}
                  onClick={() => void start()}
                >
                  Upload và xử lý
                </button>
              </>
            )}
            {phase === "has_failed" && (
              <>
                {failedPages.length > 0 && (
                  <button type="button" className="btn-primary" onClick={() => void uploadAll(failedPages)}>
                    Thử lại {failedPages.length} file lỗi
                  </button>
                )}
                <button type="button" onClick={() => void commit()}>
                  {failedPages.length ? "Bỏ qua file lỗi và xử lý" : "Xử lý"}
                </button>
              </>
            )}
            {phase === "rejected" && chapter.current && (
              <Link
                className="btn btn-primary"
                to="/w/$ws/series/$seriesId/chapters/$chapterId"
                params={{ ws, seriesId, chapterId: chapter.current.id }}
              >
                Mở chương
              </Link>
            )}
            {(phase === "uploading" || phase === "committing") && (
              <span className="status" data-tone="busy">
                {phase === "uploading" ? "Đang upload…" : "Đang kiểm file…"}
              </span>
            )}
          </div>
          {phase !== "select" && (
            <div className="bar" style={{ marginBottom: 8 }}>
              <span style={{ width: `${totalBytes ? (100 * uploadedBytes) / totalBytes : 0}%` }} />
            </div>
          )}
          <table className="data">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Tên file</th>
                <th className="num">Dung lượng</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pages.map((p, i) => {
                const s = states[p.key];
                return (
                  <tr
                    key={p.key}
                    draggable={!locked}
                    onDragStart={() => {
                      dragFrom.current = i;
                    }}
                    onDragOver={(e) => !locked && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragFrom.current !== null) move(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                    style={{ cursor: locked ? undefined : "grab" }}
                  >
                    <td className="num">{i + 1}</td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>
                      {p.name}
                    </td>
                    <td className="num">{fmtBytes(p.size)}</td>
                    <td>
                      {p.problem ? (
                        <span className="status" data-tone="danger">
                          {p.problem}
                        </span>
                      ) : s ? (
                        <FileStatus s={s} size={p.size} />
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {!locked && (
                        <>
                          <button type="button" className="btn-ghost" aria-label="Lên" onClick={() => move(i, i - 1)}>
                            ↑
                          </button>
                          <button type="button" className="btn-ghost" aria-label="Xuống" onClick={() => move(i, i + 1)}>
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-danger"
                            onClick={() => setPages((c) => c.filter((x) => x.key !== p.key))}
                          >
                            Bỏ
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FileStatus({ s, size }: { s: ItemState; size: number }) {
  if (s.status === "done")
    return (
      <span className="status" data-tone="ok">
        Xong
      </span>
    );
  if (s.status === "failed") {
    return (
      <span className="status" data-tone="danger" title={s.error ?? ""}>
        Lỗi sau {s.attempts} lần — {s.error}
      </span>
    );
  }
  const pct = Math.min(100, Math.round((100 * s.loaded) / Math.max(size, 1)));
  return (
    <span className="status" data-tone="busy">
      {s.attempts > 1 ? `Thử lại lần ${s.attempts} · ` : ""}
      {pct}%
    </span>
  );
}
