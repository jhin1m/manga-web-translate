/**
 * Cài đặt admin → Pipeline (chung toàn hệ thống), chia theo từng bước xử lý trang: phát hiện chữ → đọc chữ (OCR engine
 * theo ngôn ngữ nguồn + model AI đọc chữ) → xoá chữ → dịch → hiệu đính. Model AI của từng bước (slot) nằm ngay trong
 * bước đó thay vì một mục riêng.
 * Tự lưu: ô chọn lưu ngay khi đổi; ô số lưu khi rời ô (hoặc Enter) nếu hợp lệ. Lưu lỗi → trả ô về giá trị server.
 * Có hiệu lực từ lần chạy sau; job đang chờ giữ cài đặt cũ.
 */
import {
  type AiSlots,
  type AiTaskSlot,
  DEFAULT_PIPELINE_SETTINGS,
  DETECTION_THRESHOLD,
  INPAINT_SIZE,
  INPAINTERS,
  LANG_NAMES,
  MASK_DILATION,
  OCR_ENGINES,
  type OcrEngine,
  ocrEngineSupports,
  type PipelineSettings,
  SOURCE_LANGS,
  TEXT_DETECTORS,
} from "@mtl/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  EraserIcon,
  LanguagesIcon,
  ScanIcon,
  ScanTextIcon,
  SpellCheckIcon,
  WorkflowIcon,
} from "../../app/settings-icons.tsx";
import { api } from "../../lib/api.ts";
import { adminSettingsKey, providerError, useAdminSettings, useProviders } from "../admin/api.ts";
import type { SavedProvider } from "../admin/provider-form-model.ts";
import { descId, SaveStatus, SectionHead, SetGroup, SetRow } from "../admin/settings-ui.tsx";

const DETECTOR_LABEL: Record<(typeof TEXT_DETECTORS)[number], string> = {
  rtdetr_v2_comic: "RT-DETR v2 comic (mặc định)",
  comic_text_detector: "Comic Text Detector (CTD)",
};
const OCR_LABEL: Record<OcrEngine, string> = {
  llm: "AI (LLM vision) — tính token",
  manga_ocr: "MangaOCR — local",
  paddle_ocr: "PaddleOCR — local",
};
const INPAINTER_LABEL: Record<(typeof INPAINTERS)[number], string> = {
  big_lama: "Big LaMa (mặc định)",
  lama_manga: "LaMa manga",
};

type Save = { kind: "pipeline"; pipeline: PipelineSettings } | { kind: "slots"; slots: AiSlots };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Giữ bản đang sửa; server đổi (lưu xong, tab khác lưu) chỉ nạp lại khi bản đang sửa khớp bản server trước đó. */
function useSynced<T>(server: T) {
  const [v, setV] = useState<T>(server);
  const base = useRef(server);
  useEffect(() => {
    setV((cur) => (same(cur, base.current) ? server : cur));
    base.current = server;
  }, [server]);
  return [v, setV, base] as const;
}

/**
 * Ô số tự lưu (hẹp, kèm khoảng cho phép bên cạnh): gõ tự do, rời ô / Enter mới lưu nếu trình duyệt thấy hợp lệ (min /
 * max / required); sai thì báo lỗi dưới ô và không lưu. `null` = để trống (chỉ khi `allowEmpty`).
 */
function NumField(props: {
  id: string;
  value: number | null;
  min: number;
  max: number;
  step: number | "any";
  allowEmpty?: boolean;
  placeholder?: string;
  onCommit(v: number | null): void;
}) {
  const shown = props.value === null ? "" : String(props.value);
  const [text, setText] = useState(shown);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(shown), [shown]);
  const commit = (el: HTMLInputElement) => {
    if (!el.checkValidity()) {
      setErr(el.validationMessage);
      return;
    }
    setErr(null);
    const next = text.trim() === "" ? null : Number(text);
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <>
      <span className="num-field">
        <input
          id={props.id}
          aria-describedby={descId(props.id)}
          aria-invalid={err ? true : undefined}
          type="number"
          step={props.step}
          min={props.min}
          max={props.max}
          required={!props.allowEmpty}
          placeholder={props.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget);
            }
          }}
        />
        <span className="muted small">
          {props.min}–{props.max}
        </span>
      </span>
      {err && <span className="error small">{err}</span>}
    </>
  );
}

/** Chọn model AI cho một bước: gom theo nhà cung cấp; bước cần đọc ảnh chỉ hiện model có vision. */
function ModelSelect(props: {
  id: string;
  value: string | null;
  vision: boolean;
  providers: SavedProvider[];
  onChange(v: string | null): void;
}) {
  return (
    <select
      id={props.id}
      aria-describedby={descId(props.id)}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || null)}
    >
      <option value="">Theo worker (.env)</option>
      {props.providers.map((p) => {
        const models = p.models.filter((m) => !props.vision || m.vision);
        if (!models.length) return null;
        return (
          <optgroup key={p.id} label={p.name}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.model_id}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

const ENV_HINT = "“Theo worker” = dùng model và key đặt trong .env của worker.";

function PipelineForm(props: { pipeline: PipelineSettings; slots: AiSlots; providers: SavedProvider[] }) {
  const qc = useQueryClient();
  const [f, setF, pipeBase] = useSynced(props.pipeline);
  const [slots, setSlots, slotsBase] = useSynced(props.slots);
  const [confirmReset, setConfirmReset] = useState(false);

  // Cùng `scope` → các lần lưu chạy nối tiếp, lần đổi sau không bị lần trước ghi đè.
  const save = useMutation({
    scope: { id: "admin-settings" },
    mutationFn: (s: Save) =>
      s.kind === "pipeline"
        ? api("/api/admin/settings/pipeline", { method: "PUT", body: { pipeline: s.pipeline } })
        : api("/api/admin/settings/slots", { method: "PUT", body: s.slots }),
    onError: (_e, s) => (s.kind === "pipeline" ? setF(pipeBase.current) : setSlots(slotsBase.current)),
    onSettled: () => qc.invalidateQueries({ queryKey: adminSettingsKey }),
  });

  const setPipe = (next: PipelineSettings) => {
    setF(next);
    save.mutate({ kind: "pipeline", pipeline: next });
  };
  const set = <K extends keyof PipelineSettings>(k: K, v: PipelineSettings[K]) => setPipe({ ...f, [k]: v });
  const setSlot = (slot: AiTaskSlot, v: string | null) => {
    const next = { ...slots, [slot]: v };
    setSlots(next);
    save.mutate({ kind: "slots", slots: next });
  };

  const usesAiOcr = SOURCE_LANGS.some((l) => f.ocr_engines[l] === "llm");
  const isDefault = same(f, DEFAULT_PIPELINE_SETTINGS);

  return (
    // Không có nút Lưu: chặn submit (Enter trong ô) — ô số tự lưu khi Enter / rời ô.
    <form className="set-section" aria-label="Cài đặt pipeline" onSubmit={(e) => e.preventDefault()}>
      <SectionHead
        title="Pipeline"
        icon={<WorkflowIcon />}
        desc="Model và tuỳ chọn xử lý từng trang, cho mọi người dùng."
        tip="Áp dụng từ lần chạy sau; chương đã xử lý không tự chạy lại."
        aside={
          <>
            <SaveStatus
              pending={save.isPending}
              error={save.error ? providerError(save.error) : null}
              saved={save.isSuccess}
            />
            {confirmReset ? (
              <>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    setConfirmReset(false);
                    setPipe(structuredClone(DEFAULT_PIPELINE_SETTINGS));
                  }}
                >
                  Về mặc định?
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}>
                  Huỷ
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                title="Đặt lại phát hiện, đọc và xoá chữ về mặc định (giữ model AI)"
                disabled={isDefault}
                onClick={() => setConfirmReset(true)}
              >
                Về mặc định
              </button>
            )}
          </>
        }
      />

      {props.providers.length === 0 && (
        <p className="notice info">
          Chưa có nhà cung cấp AI nào nên các bước AI đang dùng cấu hình .env của worker.{" "}
          <Link to="/settings" search={{ section: "providers" }}>
            Thêm nhà cung cấp
          </Link>
        </p>
      )}

      <SetGroup title="Phát hiện chữ" icon={<ScanIcon />} step={1} desc="Tìm chữ và bóng thoại trên trang.">
        <SetRow
          label="Model"
          htmlFor="p-detector"
          desc="RT-DETR tìm cả bóng thoại lẫn chữ. CTD bám sát khối chữ nhỏ / chữ dọc hơn, bóng thoại vẫn lấy từ RT-DETR."
        >
          <select
            id="p-detector"
            aria-describedby={descId("p-detector")}
            value={f.detector}
            onChange={(e) => set("detector", e.target.value as PipelineSettings["detector"])}
          >
            {TEXT_DETECTORS.map((d) => (
              <option key={d} value={d}>
                {DETECTOR_LABEL[d]}
              </option>
            ))}
          </select>
        </SetRow>
        <SetRow
          label="Ngưỡng tin cậy"
          htmlFor="p-threshold"
          desc={`${DETECTION_THRESHOLD.min}–${DETECTION_THRESHOLD.max}, mặc định ${DETECTION_THRESHOLD.default}. Thấp hơn bắt thêm chữ nhỏ nhưng dễ nhận nhầm; cao hơn dễ bỏ sót.`}
        >
          <NumField
            id="p-threshold"
            value={f.detection_threshold}
            min={DETECTION_THRESHOLD.min}
            max={DETECTION_THRESHOLD.max}
            step="any"
            onCommit={(v) => set("detection_threshold", v ?? DETECTION_THRESHOLD.default)}
          />
        </SetRow>
      </SetGroup>

      <SetGroup
        title="Đọc chữ (OCR)"
        icon={<ScanTextIcon />}
        step={2}
        desc="Đọc chữ gốc trong vùng đã phát hiện, theo ngôn ngữ gốc của series."
        tip="OCR local miễn phí và ảnh không rời máy; AI đọc tốt mọi ngôn ngữ, nhận cả SFX nhưng tính token."
      >
        {SOURCE_LANGS.map((lang) => (
          <SetRow key={lang} label={LANG_NAMES[lang]} htmlFor={`p-ocr-${lang}`}>
            <select
              id={`p-ocr-${lang}`}
              value={f.ocr_engines[lang]}
              onChange={(e) => set("ocr_engines", { ...f.ocr_engines, [lang]: e.target.value as OcrEngine })}
            >
              {OCR_ENGINES.filter((o) => ocrEngineSupports(o, lang)).map((o) => (
                <option key={o} value={o}>
                  {OCR_LABEL[o]}
                </option>
              ))}
            </select>
          </SetRow>
        ))}
        <SetRow
          label="Model AI đọc chữ"
          htmlFor="slot-ocr"
          desc={
            usesAiOcr
              ? `Dùng cho ngôn ngữ chọn AI ở trên. Chỉ hiện model có vision. ${ENV_HINT}`
              : "Chưa ngôn ngữ nào chọn AI nên model này chưa được dùng. Chỉ hiện model có vision."
          }
        >
          <ModelSelect
            id="slot-ocr"
            value={slots.ocr}
            vision
            providers={props.providers}
            onChange={(v) => setSlot("ocr", v)}
          />
        </SetRow>
      </SetGroup>

      <SetGroup
        title="Xoá chữ"
        icon={<EraserIcon />}
        step={3}
        desc="Vẽ lại nền sau khi xoá chữ."
        tip="Nền phẳng luôn được tô màu trực tiếp trước."
      >
        <SetRow
          label="Model"
          htmlFor="p-inpainter"
          desc="LaMa manga giữ screentone và nét vẽ manga tốt hơn; Big LaMa hợp ảnh màu, nền nhiều chi tiết."
        >
          <select
            id="p-inpainter"
            aria-describedby={descId("p-inpainter")}
            value={f.inpainter}
            onChange={(e) => set("inpainter", e.target.value as PipelineSettings["inpainter"])}
          >
            {INPAINTERS.map((m) => (
              <option key={m} value={m}>
                {INPAINTER_LABEL[m]}
              </option>
            ))}
          </select>
        </SetRow>
        <SetRow
          label="Nới vùng xoá (px)"
          htmlFor="p-dilation"
          desc={`${MASK_DILATION.min}–${MASK_DILATION.max}. Để trống = tự động 2–6px theo cỡ chữ. Tăng khi còn sót viền chữ.`}
        >
          <NumField
            id="p-dilation"
            value={f.mask_dilation}
            min={MASK_DILATION.min}
            max={MASK_DILATION.max}
            step={1}
            allowEmpty
            placeholder="Tự động"
            onCommit={(v) => set("mask_dilation", v)}
          />
        </SetRow>
        <SetRow
          label="Cỡ vùng xử lý (px)"
          htmlFor="p-size"
          desc={`${INPAINT_SIZE.min}–${INPAINT_SIZE.max}, mặc định ${INPAINT_SIZE.default}. Lớn hơn: ít lượt chạy, thấy nhiều nền xung quanh nhưng mờ hơn.`}
        >
          <NumField
            id="p-size"
            value={f.inpaint_size}
            min={INPAINT_SIZE.min}
            max={INPAINT_SIZE.max}
            step={1}
            onCommit={(v) => set("inpaint_size", v ?? INPAINT_SIZE.default)}
          />
        </SetRow>
      </SetGroup>

      <SetGroup title="Dịch" icon={<LanguagesIcon />} step={4} desc="Dịch chữ gốc sang ngôn ngữ đích của series.">
        <SetRow label="Model AI" htmlFor="slot-translate" desc={ENV_HINT}>
          <ModelSelect
            id="slot-translate"
            value={slots.translate}
            vision={false}
            providers={props.providers}
            onChange={(v) => setSlot("translate", v)}
          />
        </SetRow>
      </SetGroup>

      <SetGroup
        title="Hiệu đính"
        icon={<SpellCheckIcon />}
        step={5}
        desc="AI đối chiếu bản dịch với ảnh trang để sửa lỗi đọc / dịch."
      >
        <SetRow label="Model AI" htmlFor="slot-proofread" desc={`Chỉ hiện model có vision. ${ENV_HINT}`}>
          <ModelSelect
            id="slot-proofread"
            value={slots.proofread}
            vision
            providers={props.providers}
            onChange={(v) => setSlot("proofread", v)}
          />
        </SetRow>
      </SetGroup>
    </form>
  );
}

export function PipelineSection() {
  const settings = useAdminSettings();
  const providers = useProviders();
  const error = settings.error ?? providers.error;
  if (error) return <p className="error">{providerError(error)}</p>;
  if (!settings.data || !providers.data) return <p className="muted">Đang tải…</p>;
  return (
    <PipelineForm pipeline={settings.data.pipeline} slots={settings.data.slots} providers={providers.data.providers} />
  );
}
