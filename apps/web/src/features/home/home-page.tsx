/**
 * Home, từ trên xuống: dải thả (thả bất kỳ đâu trên trang cũng được; chưa có series nào thì là vùng lớn; đoán được
 * series → tạo chương + tải ảnh + mở màn chương, không thì dòng "Vừa thả" inline) → ô tìm + "+ Series" (mở modal
 * tạo series: tên, loại truyện, Dịch từ / Sang) + thanh sắp xếp / Lưới–Danh sách → lưới thẻ series có bìa hoặc danh
 * sách hàng không ảnh (bấm thẻ để mở series, icon Sửa → cài đặt series, icon Xoá → xác nhận rồi xoá cả series).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useT } from "../../i18n/t.ts";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { needsWork, nextAction } from "../chapter/next-action.ts";
import { deleteSeries, fetchSeriesList, type SeriesListItem, seriesKeys } from "../series/api.ts";
import { NewSeriesDialog } from "../series/new-series-dialog.tsx";
import { DropZone, usePageDrop } from "../upload/drop-zone.tsx";
import { normalizeName } from "../upload/parse-chapter-filename.ts";
import { CoverImage, initialOf, withStatus } from "./cover-image.tsx";
import { useDropToTranslate } from "./drop-to-translate.ts";
import { type ListView, SERIES_PREFS_KEY, SERIES_SORTS, sortSeries, useListPrefs } from "./list-prefs.ts";
import { ListToolbar } from "./list-toolbar.tsx";
import { NewChapterConfirmRow } from "./new-chapter-confirm-row.tsx";
import { PencilIcon, TrashIcon } from "./row-icons.tsx";
import "./home.css";

type Pending = { files: File[]; seriesId?: string; seq: number };

export function HomePage() {
  const { t } = useT();
  const seriesQ = useQuery({ queryKey: seriesKeys.list(), queryFn: () => fetchSeriesList() });
  const [pending, setPending] = useState<Pending | null>(null);
  const auto = useDropToTranslate((files, seriesId) =>
    setPending((p) => ({ files, seriesId, seq: (p?.seq ?? 0) + 1 })),
  );
  const drop = (files: File[], seriesId?: string) => {
    setPending(null);
    auto.mutate({ files, seriesId });
  };
  usePageDrop((files) => drop(files));
  const series = seriesQ.data?.series;

  return (
    <main className="home">
      <DropZone
        label={t("home.page.dropLabel")}
        size={series?.length === 0 ? "lg" : "strip"}
        title={series?.length === 0 ? t("home.page.dropTitleEmpty") : t("home.page.dropTitle")}
        hint={t("home.page.dropHint")}
        onFiles={(f) => drop(f)}
      />
      {auto.isPending && (
        <p className="small muted" role="status">
          {t("home.page.creating")}
        </p>
      )}
      {auto.error && <p className="notice danger">{errorMessage(auto.error)}</p>}
      {pending && series && (
        <NewChapterConfirmRow
          key={pending.seq}
          files={pending.files}
          series={series}
          fixedSeriesId={pending.seriesId}
          onCancel={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      )}
      <SeriesGrid series={series} error={seriesQ.error} />
    </main>
  );
}

function SeriesGrid(props: { series: SeriesListItem[] | undefined; error: unknown }) {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const prefs = useListPrefs(SERIES_PREFS_KEY, SERIES_SORTS);
  const { view, sort, dir } = prefs.prefs;
  const needle = normalizeName(search);
  const list = sortSeries(
    (props.series ?? []).filter((s) => !needle || normalizeName(s.title).includes(needle)),
    sort,
    dir,
  );

  return (
    <section aria-label="Series" className="block">
      <div className="block-head">
        <input
          type="search"
          aria-label={t("home.page.search")}
          placeholder={t("home.page.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" onClick={() => setAdding(true)}>
          + Series
        </button>
        <ListToolbar options={SERIES_SORTS} control={prefs} />
      </div>
      {adding && <NewSeriesDialog onClose={() => setAdding(false)} />}
      {!!props.error && <p className="notice danger">{errorMessage(props.error)}</p>}
      {props.series && list.length === 0 && (
        <div className="rows-empty">{search ? t("home.page.noMatch") : t("home.page.empty")}</div>
      )}
      {list.length > 0 && (
        <div className={view === "list" ? "card-list" : "card-grid"}>
          {list.map((s) => (
            <SeriesCard key={s.id} s={s} layout={view} />
          ))}
        </div>
      )}
    </section>
  );
}

function SeriesCard({ s, layout }: { s: SeriesListItem; layout: ListView }) {
  const { t, tp } = useT();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const latest = s.latest_chapter;
  const a = latest ? nextAction(latest) : null;
  const state =
    !latest || !a
      ? t("home.page.noChapters")
      : needsWork(latest)
        ? `Ch.${latest.number} · ${a.state}`
        : t("home.page.allExported");
  const tone = !latest || !a ? "idle" : needsWork(latest) ? a.tone : "ok";
  // Bìa tự động 404 khi series vừa tạo bằng thao tác thả (ảnh đang lên): src đổi theo số chương / trạng thái chương
  // mới nhất để thử tải lại đúng lúc; không đổi giữa các lượt polling. Bìa riêng luôn có sẵn nên giữ nguyên.
  const cover =
    s.cover_src && !s.cover_custom
      ? withStatus(s.cover_src, `${s.chapter_count}-${latest?.status ?? ""}`)
      : s.cover_src;
  return (
    <div className="card" data-series={s.id}>
      <Link className="card-open" to="/s/$seriesId" params={{ seriesId: s.id }} inert={confirming}>
        {layout === "grid" && <CoverImage src={cover} fallback={initialOf(s.title)} />}
        <span className="card-body">
          <span className="card-name" title={s.title}>
            {s.title}
          </span>
          <span className="card-state small" title={state}>
            <span className="dot" data-tone={tone} />
            <span className="card-state-text">{state}</span>
          </span>
          <span className="small muted" title={tp("home.page.chapterCount", s.chapter_count)}>
            {s.chapter_count} ch
          </span>
        </span>
      </Link>
      <div className="card-actions" inert={confirming}>
        <Link
          className="btn icon-btn"
          to="/s/$seriesId"
          params={{ seriesId: s.id }}
          search={{ tab: "settings" }}
          aria-label={t("home.page.editAria", { title: s.title })}
          title={t("home.page.edit")}
        >
          <PencilIcon />
        </Link>
        <button
          type="button"
          className="icon-btn"
          data-danger
          aria-label={t("home.page.deleteAria", { title: s.title })}
          title={t("home.page.delete")}
          onClick={() => {
            setMsg(null);
            setConfirming(true);
          }}
        >
          <TrashIcon />
        </button>
      </div>
      {confirming && (
        <DeleteSeriesConfirm
          s={s}
          onDone={() => setConfirming(false)}
          onError={(text) => {
            setConfirming(false);
            setMsg(text);
          }}
        />
      )}
      {msg && <div className="row-error">{msg}</div>}
    </div>
  );
}

/** Xác nhận tại chỗ: xoá series cùng mọi chương + glossary riêng (không hoàn tác). */
function DeleteSeriesConfirm(props: { s: SeriesListItem; onDone: () => void; onError: (text: string) => void }) {
  const { s } = props;
  const { t, tp, tNode } = useT();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteSeries(s.id),
    onSuccess: () => {
      props.onDone();
      qc.removeQueries({ queryKey: seriesKeys.detail(s.id) });
      void qc.invalidateQueries({ queryKey: seriesKeys.list() });
    },
    onError: (e) =>
      props.onError(e instanceof ApiError && e.status === 423 ? t("home.page.deleteLocked") : errorMessage(e)),
  });
  return (
    <div className="card-confirm" role="alertdialog" aria-label={t("home.page.deleteConfirmAria", { title: s.title })}>
      <span className="small">
        {tNode("home.page.deleteConfirm", {
          title: <b>{s.title}</b>,
          chapters: s.chapter_count > 0 ? tp("home.page.deleteChapters", s.chapter_count) : "",
        })}
      </span>
      <button
        type="button"
        className="btn-danger-solid"
        disabled={del.isPending}
        // biome-ignore lint/a11y/noAutofocus: vừa bấm xoá → Enter xác nhận, Esc/Tab sang Huỷ
        autoFocus
        onClick={() => del.mutate()}
      >
        {del.isPending ? t("home.page.deleting") : t("home.page.delete")}
      </button>
      <button type="button" disabled={del.isPending} onClick={props.onDone}>
        {t("common.cancel")}
      </button>
    </div>
  );
}
