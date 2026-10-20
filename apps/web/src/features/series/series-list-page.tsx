import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { CHAPTER_STATUS } from "../chapter/status.ts";
import { createSeries, fetchSeries, fetchSeriesList, seriesKeys } from "./api.ts";

const fmtDate = (s: string) =>
  new Date(s).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Danh sách series của workspace + tạo series. */
export function SeriesListPage({ ws }: { ws: string }) {
  const q = useQuery({ queryKey: seriesKeys.list(ws), queryFn: () => fetchSeriesList(ws) });
  const [title, setTitle] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => createSeries(ws, { title }),
    onSuccess: (s) => {
      setTitle("");
      void qc.invalidateQueries({ queryKey: seriesKeys.list(ws) });
      void navigate({ to: "/w/$ws/s/$seriesId", params: { ws, seriesId: s.id }, search: { tab: "settings" } });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Series</h1>
        <span className="spacer" />
        <form onSubmit={submit} className="row">
          <input
            aria-label="Tên series mới"
            placeholder="Tên series mới"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: 260 }}
          />
          <button type="submit" className="btn-primary" disabled={create.isPending || !title.trim()}>
            Tạo series
          </button>
        </form>
      </div>
      {(q.error || create.error) && <p className="notice danger">{errorMessage(q.error ?? create.error)}</p>}
      {q.data?.series.length === 0 && <p className="muted">Chưa có series nào.</p>}
      {!!q.data?.series.length && (
        <table className="data">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Ngôn ngữ</th>
              <th className="num">Chương</th>
              <th>Model</th>
              <th>Hoạt động gần nhất</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.series.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId: s.id }} style={{ fontWeight: 500 }}>
                    {s.title}
                  </Link>
                </td>
                <td className="mono">
                  {s.source_lang} → {s.target_lang}
                </td>
                <td className="num">{s.chapter_count}</td>
                <td>{s.llm_tier}</td>
                <td className="muted">{fmtDate(s.last_activity_at)}</td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/w/$ws/series/$seriesId/upload" params={{ ws, seriesId: s.id }}>
                    Upload
                  </Link>
                  {" · "}
                  <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId: s.id }} search={{ tab: "settings" }}>
                    Cài đặt
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Một series: danh sách chương. */
export function SeriesDetailPage({ ws, seriesId }: { ws: string; seriesId: string }) {
  const q = useQuery({
    queryKey: seriesKeys.detail(ws, seriesId),
    queryFn: () => fetchSeries(ws, seriesId),
    // Trạng thái chương đổi theo worker — làm mới chậm khi còn chương đang chạy.
    refetchInterval: (query) =>
      query.state.data?.chapters.some((c) => c.status === "ingesting" || c.status === "processing") ? 5000 : false,
  });
  const s = q.data;
  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/">Series</Link>
      </div>
      <div className="page-head">
        <h1>{s?.title ?? "…"}</h1>
        <span className="spacer" />
        <Link className="btn" to="/w/$ws/s/$seriesId" params={{ ws, seriesId }} search={{ tab: "settings" }}>
          Cài đặt &amp; glossary
        </Link>
        <Link className="btn btn-primary" to="/w/$ws/series/$seriesId/upload" params={{ ws, seriesId }}>
          Upload chương
        </Link>
      </div>
      {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
      {s && s.chapters.length === 0 && <p className="muted">Chưa có chương nào.</p>}
      {s && s.chapters.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th className="num">Chương</th>
              <th>Tên</th>
              <th>Trạng thái</th>
              <th>Khoá</th>
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {s.chapters.map((c) => {
              const st = CHAPTER_STATUS[c.status];
              return (
                <tr key={c.id}>
                  <td className="num">
                    <Link
                      to="/w/$ws/s/$seriesId/c/$chapterId"
                      params={{ ws, seriesId, chapterId: c.id }}
                      style={{ fontWeight: 500 }}
                    >
                      {c.number}
                    </Link>
                  </td>
                  <td>{c.title || <span className="muted">—</span>}</td>
                  <td>
                    <span className="status" data-tone={st.tone}>
                      {st.label}
                    </span>
                  </td>
                  <td className="muted small">{c.locked_by ? "đang có người sửa" : ""}</td>
                  <td className="muted">{fmtDate(c.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
