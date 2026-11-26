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
  autoSlotModel,
  DEFAULT_PIPELINE_SETTINGS,
  DETECTION_THRESHOLD,
  INPAINT_SIZE,
  INPAINTERS,
  MASK_DILATION,
  OCR_ENGINES,
  type OcrEngine,
  ocrEngineSupports,
  type PipelineSettings,
  SOURCE_LANGS,
  TEXT_DETECTORS,
  VISION_SLOTS,
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
import { type MessageKey, t, useT } from "../../i18n/t.ts";
import { api } from "../../lib/api.ts";
import { adminSettingsKey, providerError, useAdminSettings, useProviders } from "../admin/api.ts";
import type { SavedProvider } from "../admin/provider-form-model.ts";
import { descId, SaveStatus, SectionHead, SetGroup, SetRow } from "../admin/settings-ui.tsx";
import { langName } from "../series/lang-labels.ts";

const DETECTOR_LABEL: Readonly<Record<(typeof TEXT_DETECTORS)[number], MessageKey>> = {
  rtdetr_v2_comic: "pipeline.pipelineSettings.detector.rtdetr_v2_comic",
  comic_text_detector: "pipeline.pipelineSettings.detector.comic_text_detector",
};
const OCR_LABEL: Readonly<Record<OcrEngine, MessageKey>> = {
  llm: "pipeline.pipelineSettings.ocr.llm",
  manga_ocr: "pipeline.pipelineSettings.ocr.manga_ocr",
  paddle_ocr: "pipeline.pipelineSettings.ocr.paddle_ocr",
};
const INPAINTER_LABEL: Readonly<Record<(typeof INPAINTERS)[number], MessageKey>> = {
  big_lama: "pipeline.pipelineSettings.inpainter.big_lama",
  lama_manga: "pipeline.pipelineSettings.inpainter.lama_manga",
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

/**
 * Chọn model AI cho một bước: "Tự động" (mặc định) kèm model hệ thống đang chọn, rồi các model gom theo nhà cung cấp;
 * bước cần đọc ảnh chỉ hiện model có vision.
 */
function ModelSelect(props: {
  id: string;
  slot: AiTaskSlot;
  value: string | null;
  providers: SavedProvider[];
  onChange(v: string | null): void;
}) {
  const vision = VISION_SLOTS.includes(props.slot);
  const auto = autoSlotModel(props.providers, props.slot)?.model.model_id;
  return (
    <select
      id={props.id}
      aria-describedby={descId(props.id)}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || null)}
    >
      <option value="">
        {auto ? t("pipeline.pipelineSettings.autoWithModel", { model: auto }) : t("pipeline.pipelineSettings.auto")}
      </option>
      {props.providers.map((p) => {
        const models = p.models.filter((m) => !vision || m.vision);
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

/** Gợi ý dưới ô model: "Tự động" làm gì, và cần thêm gì khi chưa có model hợp. */
function autoHint(providers: SavedProvider[], slot: AiTaskSlot): string {
  if (autoSlotModel(providers, slot)) return t("pipeline.pipelineSettings.autoHint");
  return VISION_SLOTS.includes(slot) && providers.length > 0
    ? t("pipeline.pipelineSettings.noVisionModel")
    : t("pipeline.pipelineSettings.noModel");
}

function PipelineForm(props: { pipeline: PipelineSettings; slots: AiSlots; providers: SavedProvider[] }) {
  useT();
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
    <form
      className="set-section"
      aria-label={t("pipeline.pipelineSettings.formLabel")}
      onSubmit={(e) => e.preventDefault()}
    >
      <SectionHead
        title="Pipeline"
        icon={<WorkflowIcon />}
        desc={t("pipeline.pipelineSettings.sectionDesc")}
        tip={t("pipeline.pipelineSettings.sectionTip")}
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
                  {t("pipeline.pipelineSettings.resetConfirm")}
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}>
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                title={t("pipeline.pipelineSettings.resetTitle")}
                disabled={isDefault}
                onClick={() => setConfirmReset(true)}
              >
                {t("pipeline.pipelineSettings.reset")}
              </button>
            )}
          </>
        }
      />

      {props.providers.length === 0 && (
        <p className="notice info">
          {t("pipeline.pipelineSettings.noProviders")}{" "}
          <Link to="/settings" search={{ section: "providers" }}>
            {t("pipeline.pipelineSettings.addProvider")}
          </Link>
        </p>
      )}

      <SetGroup
        title={t("pipeline.pipelineSettings.detect.title")}
        icon={<ScanIcon />}
        step={1}
        desc={t("pipeline.pipelineSettings.detect.desc")}
      >
        <SetRow label="Model" htmlFor="p-detector" desc={t("pipeline.pipelineSettings.detect.modelDesc")}>
          <select
            id="p-detector"
            aria-describedby={descId("p-detector")}
            value={f.detector}
            onChange={(e) => set("detector", e.target.value as PipelineSettings["detector"])}
          >
            {TEXT_DETECTORS.map((d) => (
              <option key={d} value={d}>
                {t(DETECTOR_LABEL[d])}
              </option>
            ))}
          </select>
        </SetRow>
        <SetRow
          label={t("pipeline.pipelineSettings.detect.threshold")}
          htmlFor="p-threshold"
          desc={t("pipeline.pipelineSettings.detect.thresholdDesc", {
            min: DETECTION_THRESHOLD.min,
            max: DETECTION_THRESHOLD.max,
            default: DETECTION_THRESHOLD.default,
          })}
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
        title={t("pipeline.pipelineSettings.ocrStep.title")}
        icon={<ScanTextIcon />}
        step={2}
        desc={t("pipeline.pipelineSettings.ocrStep.desc")}
        tip={t("pipeline.pipelineSettings.ocrStep.tip")}
      >
        {SOURCE_LANGS.map((lang) => (
          <SetRow key={lang} label={langName(lang)} htmlFor={`p-ocr-${lang}`}>
            <select
              id={`p-ocr-${lang}`}
              value={f.ocr_engines[lang]}
              onChange={(e) => set("ocr_engines", { ...f.ocr_engines, [lang]: e.target.value as OcrEngine })}
            >
              {OCR_ENGINES.filter((o) => ocrEngineSupports(o, lang)).map((o) => (
                <option key={o} value={o}>
                  {t(OCR_LABEL[o])}
                </option>
              ))}
            </select>
          </SetRow>
        ))}
        <SetRow
          label={t("pipeline.pipelineSettings.ocrStep.model")}
          htmlFor="slot-ocr"
          desc={
            usesAiOcr
              ? t("pipeline.pipelineSettings.ocrStep.modelDesc", { hint: autoHint(props.providers, "ocr") })
              : t("pipeline.pipelineSettings.ocrStep.modelUnused")
          }
        >
          <ModelSelect
            id="slot-ocr"
            slot="ocr"
            value={slots.ocr}
            providers={props.providers}
            onChange={(v) => setSlot("ocr", v)}
          />
        </SetRow>
      </SetGroup>

      <SetGroup
        title={t("pipeline.pipelineSettings.clean.title")}
        icon={<EraserIcon />}
        step={3}
        desc={t("pipeline.pipelineSettings.clean.desc")}
        tip={t("pipeline.pipelineSettings.clean.tip")}
      >
        <SetRow label="Model" htmlFor="p-inpainter" desc={t("pipeline.pipelineSettings.clean.modelDesc")}>
          <select
            id="p-inpainter"
            aria-describedby={descId("p-inpainter")}
            value={f.inpainter}
            onChange={(e) => set("inpainter", e.target.value as PipelineSettings["inpainter"])}
          >
            {INPAINTERS.map((m) => (
              <option key={m} value={m}>
                {t(INPAINTER_LABEL[m])}
              </option>
            ))}
          </select>
        </SetRow>
        <SetRow
          label={t("pipeline.pipelineSettings.clean.dilation")}
          htmlFor="p-dilation"
          desc={t("pipeline.pipelineSettings.clean.dilationDesc", { min: MASK_DILATION.min, max: MASK_DILATION.max })}
        >
          <NumField
            id="p-dilation"
            value={f.mask_dilation}
            min={MASK_DILATION.min}
            max={MASK_DILATION.max}
            step={1}
            allowEmpty
            placeholder={t("pipeline.pipelineSettings.auto")}
            onCommit={(v) => set("mask_dilation", v)}
          />
        </SetRow>
        <SetRow
          label={t("pipeline.pipelineSettings.clean.size")}
          htmlFor="p-size"
          desc={t("pipeline.pipelineSettings.clean.sizeDesc", {
            min: INPAINT_SIZE.min,
            max: INPAINT_SIZE.max,
            default: INPAINT_SIZE.default,
          })}
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

      <SetGroup
        title={t("pipeline.pipelineSettings.translate.title")}
        icon={<LanguagesIcon />}
        step={4}
        desc={t("pipeline.pipelineSettings.translate.desc")}
      >
        <SetRow
          label={t("pipeline.pipelineSettings.aiModel")}
          htmlFor="slot-translate"
          desc={autoHint(props.providers, "translate")}
        >
          <ModelSelect
            id="slot-translate"
            slot="translate"
            value={slots.translate}
            providers={props.providers}
            onChange={(v) => setSlot("translate", v)}
          />
        </SetRow>
      </SetGroup>

      <SetGroup
        title={t("pipeline.pipelineSettings.proofread.title")}
        icon={<SpellCheckIcon />}
        step={5}
        desc={t("pipeline.pipelineSettings.proofread.desc")}
      >
        <SetRow
          label={t("pipeline.pipelineSettings.aiModel")}
          htmlFor="slot-proofread"
          desc={autoHint(props.providers, "proofread")}
        >
          <ModelSelect
            id="slot-proofread"
            slot="proofread"
            value={slots.proofread}
            providers={props.providers}
            onChange={(v) => setSlot("proofread", v)}
          />
        </SetRow>
      </SetGroup>
    </form>
  );
}

export function PipelineSection() {
  useT();
  const settings = useAdminSettings();
  const providers = useProviders();
  const error = settings.error ?? providers.error;
  if (error) return <p className="error">{providerError(error)}</p>;
  if (!settings.data || !providers.data) return <p className="muted">{t("common.loading")}</p>;
  return (
    <PipelineForm pipeline={settings.data.pipeline} slots={settings.data.slots} providers={providers.data.providers} />
  );
}
