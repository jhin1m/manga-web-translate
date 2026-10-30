/**
 * Chip "Hàn → Việt" trên thanh trên màn chương → popover đổi ngôn ngữ gốc / đích của series ngay trong editor
 * (PATCH series, giống form Cài đặt series). Ngôn ngữ gốc sai (VD chọn Manhwa nhưng ảnh là bản scan tiếng Anh) làm
 * OCR bỏ trống khối có chữ — đổi ở đây rồi OCR lại vùng đó / dịch lại.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { patchSeries, type Series } from "../series/api.ts";
import {
  LANG_NAMES,
  pairLabel,
  SOURCE_LANGS,
  type SourceLang,
  TARGET_LANGS,
  type TargetLang,
} from "../series/lang-labels.ts";

export function LangPairPopover({ series }: { series: Series | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài → đóng.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!series) return null;
  return (
    <div className="cw-meta" ref={ref}>
      <button
        type="button"
        className="cw-meta-toggle small"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Đổi ngôn ngữ gốc / đích của series"
        onClick={() => setOpen((o) => !o)}
      >
        {pairLabel(series)}
      </button>
      {open && <LangPairForm series={series} onClose={() => setOpen(false)} />}
    </div>
  );
}

function LangPairForm(props: { series: Series; onClose(): void }) {
  const { series } = props;
  const qc = useQueryClient();
  const [src, setSrc] = useState<SourceLang>(series.source_lang);
  const [tgt, setTgt] = useState<TargetLang>(series.target_lang);
  const changed = src !== series.source_lang || tgt !== series.target_lang;
  const save = useMutation({
    mutationFn: () => patchSeries(series.id, { source_lang: src, target_lang: tgt }),
    onSuccess: () => {
      // Chi tiết series (editor + màn series) nằm dưới ["series"]; glossary chung theo cặp → làm mới luôn.
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["glossary"] });
      props.onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (changed && !save.isPending) save.mutate();
  };

  return (
    <form
      className="cw-meta-pop"
      role="dialog"
      aria-label="Ngôn ngữ của series"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <label>
        Ngôn ngữ gốc (chữ trên ảnh)
        <select value={src} onChange={(e) => setSrc(e.target.value as SourceLang)}>
          {SOURCE_LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Dịch sang
        <select value={tgt} onChange={(e) => setTgt(e.target.value as TargetLang)}>
          {TARGET_LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      <span className="small muted">
        Áp cho cả series từ lần chạy sau. Trang đã dịch không tự chạy lại: khối bị trống thì dùng công cụ OCR kéo khung
        quanh chữ; đổi ngôn ngữ đích thì "Dịch lại cả chương".
      </span>
      {save.error && <span className="small error">{errorMessage(save.error)}</span>}
      <div className="row">
        <button type="button" onClick={props.onClose}>
          Huỷ
        </button>
        <button type="submit" className="btn-primary" disabled={!changed || save.isPending}>
          Lưu
        </button>
      </div>
    </form>
  );
}
