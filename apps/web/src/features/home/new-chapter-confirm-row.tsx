/**
 * Dòng xác nhận inline ngay dưới vùng thả (Home + Series): tên file + kích thước, series (đoán từ tên file, có
 * "+ Series mới…"), số chương (đoán từ tên file / số tiếp theo), [Bỏ] [Tạo và mở chương]. Enter = tạo, Esc = bỏ.
 * Nhiều file: mỗi ZIP = 1 chương; nhiều ảnh lẻ → hỏi "1 chương gồm N ảnh" (mặc định) hay "N chương".
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { fmtBytes } from "../../lib/format.ts";
import { createSeries, type SeriesListItem } from "../series/api.ts";
import { collectPages, isZip, listProblems, type PageFile } from "../upload/files.ts";
import { naturalSortBy } from "../upload/natural-sort.ts";
import { parseChapterFilename } from "../upload/parse-chapter-filename.ts";
import { uploadManager } from "../upload/upload-manager.ts";

const NEW_SERIES = "__new";
const NUMBER_RE = /^\d+(\.\d+)?$/;

type Dropped = { zips: { name: string; pages: PageFile[] }[]; loose: PageFile[] };

/** ZIP giải nén riêng từng cái (mỗi ZIP = 1 chương); ảnh lẻ gom chung. */
async function readDropped(files: File[]): Promise<Dropped> {
  // Thứ tự ZIP = tên tự nhiên (ch9 trước ch10) → đánh số chương liên tiếp đúng thứ tự.
  const zips = naturalSortBy(files.filter(isZip), (f) => f.name);
  const [loose, ...zipPages] = await Promise.all([
    collectPages(files.filter((f) => !isZip(f))),
    ...zips.map((z) => collectPages([z])),
  ]);
  return { loose: loose ?? [], zips: zips.map((z, i) => ({ name: z.name, pages: zipPages[i] ?? [] })) };
}

/** "800×38.400px" của ảnh duy nhất (đọc header qua createImageBitmap); lỗi → null. */
function useImageSize(page: PageFile | undefined) {
  const [size, setSize] = useState<string | null>(null);
  useEffect(() => {
    setSize(null);
    if (!page || page.problem || typeof createImageBitmap === "undefined") return;
    let alive = true;
    createImageBitmap(page.blob)
      .then((b) => {
        if (alive) setSize(`${b.width.toLocaleString("vi-VN")}×${b.height.toLocaleString("vi-VN")}px`);
        b.close();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [page]);
  return size;
}

export function NewChapterConfirmRow(props: {
  ws: string;
  files: File[];
  series: SeriesListItem[];
  /** Series cố định (màn series / nút "+ Ch.N") — không hiện ô chọn series. */
  fixedSeriesId?: string;
  /** Số chương đề xuất ưu tiên hơn số đoán từ tên file. */
  defaultNumber?: string;
  onCancel: () => void;
  /** Tạo nhiều chương (không điều hướng). */
  onCreated?: () => void;
}) {
  const { ws, files } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ref = useRef<HTMLFormElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  // Đọc đúng bộ vừa thả (giải nén ZIP trong worker); bộ file mới → đọc lại.
  const [read, setRead] = useState<{ data?: Dropped; error?: unknown }>({});
  useEffect(() => {
    let alive = true;
    setRead({});
    readDropped(files).then(
      (data) => alive && setRead({ data }),
      (error: unknown) => alive && setRead({ error }),
    );
    return () => {
      alive = false;
    };
  }, [files]);
  const guess = useMemo(() => {
    const sorted = naturalSortBy(files, (f) => f.name);
    const g = parseChapterFilename(sorted[0]?.name ?? "", props.series);
    // Nhiều ảnh lẻ (001.jpg…054.jpg) là số trang, không phải số chương → dùng số chương tiếp theo của series.
    const looseOnly = files.length > 1 && !files.some(isZip);
    return looseOnly ? { ...g, number: null } : g;
  }, [files, props.series]);
  const [seriesId, setSeriesId] = useState(
    () => props.fixedSeriesId ?? guess.series?.id ?? props.series[0]?.id ?? NEW_SERIES,
  );
  const [newTitle, setNewTitle] = useState("");
  const [number, setNumber] = useState<string | null>(null);
  const [each, setEach] = useState(false);

  const picked = props.series.find((s) => s.id === seriesId);
  const autoNumber = props.defaultNumber ?? guess.number ?? picked?.next_number ?? "1";
  const chapterNumber = number ?? autoNumber;

  const d = read.data;
  const groups = useMemo<PageFile[][]>(() => {
    if (!d) return [];
    const loose = d.loose.length === 0 ? [] : each ? d.loose.map((p) => [p]) : [d.loose];
    return [...d.zips.map((z) => z.pages), ...loose].filter((g) => g.length > 0);
  }, [d, each]);
  const pages = groups.flat();
  const problems = groups.flatMap((g) => listProblems(g));
  const imageSize = useImageSize(pages.length === 1 ? pages[0] : undefined);
  const askMode = !!d && d.zips.length === 0 && d.loose.length > 1;

  useEffect(() => {
    if (!d) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    numberRef.current?.focus();
    numberRef.current?.select();
  }, [d]);

  // Đã tạo ở lần bấm trước (lỗi giữa chừng) → bấm lại không tạo trùng series/chương.
  const made = useRef<{ seriesId?: string; chapters: Map<number, string> }>({ chapters: new Map() });
  const create = useMutation({
    mutationFn: async () => {
      let sid = seriesId === NEW_SERIES ? made.current.seriesId : seriesId;
      if (!sid) {
        sid = (await createSeries(ws, { title: newTitle.trim() })).id;
        made.current.seriesId = sid;
      }
      const base = Number(chapterNumber);
      for (const [i, g] of groups.entries()) {
        if (made.current.chapters.has(i)) continue;
        const num = groups.length > 1 ? String(base + i) : chapterNumber;
        const { chapterId } = await uploadManager.startNewChapter({ ws, seriesId: sid, number: num, pages: g });
        made.current.chapters.set(i, chapterId);
      }
      return { seriesId: sid, created: [...made.current.chapters.values()] };
    },
    onSuccess: ({ seriesId: sid, created }) => {
      void qc.invalidateQueries({ queryKey: ["series", ws] });
      const [only] = created;
      if (created.length === 1 && only) {
        void navigate({ to: "/w/$ws/s/$seriesId/c/$chapterId", params: { ws, seriesId: sid, chapterId: only } });
      } else props.onCreated?.();
    },
  });

  const canCreate =
    !!d &&
    groups.length > 0 &&
    problems.length === 0 &&
    NUMBER_RE.test(chapterNumber) &&
    (seriesId !== NEW_SERIES || !!newTitle.trim()) &&
    !create.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canCreate) create.mutate();
  };

  const fileLabel = files.length === 1 ? files[0]?.name : `${files.length} file`;
  const sizeLabel = !d
    ? "đang đọc file…"
    : pages.length === 1 && imageSize
      ? `1 ảnh ${imageSize}`
      : `${pages.length} ảnh · ${fmtBytes(pages.reduce((n, p) => n + p.size, 0))}`;
  const lastNumber = String(Number(chapterNumber) + groups.length - 1);

  return (
    <form
      ref={ref}
      aria-label="Sau khi thả file"
      className="confirm-row"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <div className="confirm-fields">
        <div className="confirm-file">
          <span className="small muted">Vừa thả</span>
          <b>
            {fileLabel} · {sizeLabel}
          </b>
        </div>
        {!props.fixedSeriesId && (
          <label className="field">
            Series (đoán từ tên file)
            <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
              {props.series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
              <option value={NEW_SERIES}>+ Series mới…</option>
            </select>
          </label>
        )}
        {seriesId === NEW_SERIES && (
          <label className="field">
            Tên series mới
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Tên series" />
          </label>
        )}
        <label className="field">
          {groups.length > 1 ? "Từ chương số" : "Chương số"}
          <input
            ref={numberRef}
            className="num"
            inputMode="decimal"
            value={chapterNumber}
            onChange={(e) => setNumber(e.target.value.trim())}
          />
        </label>
        <span className="spacer" />
        <button type="button" onClick={props.onCancel}>
          Bỏ
        </button>
        <button type="submit" className="btn-primary" disabled={!canCreate}>
          {groups.length > 1 ? `Tạo ${groups.length} chương` : "Tạo và mở chương"}
        </button>
      </div>
      {askMode && d && (
        <div className="confirm-modes" role="radiogroup" aria-label="Cách chia chương">
          <label>
            <input type="radio" name="mode" checked={!each} onChange={() => setEach(false)} />1 chương gồm{" "}
            {d.loose.length} ảnh
          </label>
          <label>
            <input type="radio" name="mode" checked={each} onChange={() => setEach(true)} />
            {d.loose.length} chương, mỗi ảnh 1 chương
          </label>
        </div>
      )}
      {groups.length > 1 && NUMBER_RE.test(chapterNumber) && (
        <span className="small muted">
          Tạo chương {chapterNumber}–{lastNumber}, đánh số liên tiếp
          {d && d.zips.length > 1 ? " (mỗi ZIP 1 chương)" : ""}.
        </span>
      )}
      {!NUMBER_RE.test(chapterNumber) && <span className="small error">Số chương phải là số, VD 13 hoặc 13.5.</span>}
      {problems.map((p) => (
        <span key={p} className="small error">
          {p}
        </span>
      ))}
      {read.error !== undefined && <span className="small error">{errorMessage(read.error)}</span>}
      {create.error && <span className="small error">{errorMessage(create.error)}</span>}
    </form>
  );
}
