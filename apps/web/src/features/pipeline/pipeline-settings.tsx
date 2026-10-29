/**
 * Cài đặt chung → tab Pipeline: detector, OCR engine theo ngôn ngữ nguồn, inpainter, model hiệu đính; ngưỡng / nới
 * mask / cỡ vùng xoá chữ gom ở "Nâng cao". Mỗi option: nhãn tiếng Việt + thuật ngữ gốc + tooltip (dấu ?).
 * Có hiệu lực từ lần chạy sau (Xoá chữ + OCR, xoá chữ lại, OCR vùng, AI hiệu đính); job đang chờ giữ cài đặt cũ.
 */
import {
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
  PROOFREAD_TIERS,
  SOURCE_LANGS,
  TEXT_DETECTORS,
} from "@mtl/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api.ts";

const DETECTOR_LABEL: Record<(typeof TEXT_DETECTORS)[number], string> = {
  rtdetr_v2_comic: "RT-DETR v2 comic — bóng thoại + chữ (mặc định)",
  comic_text_detector: "Comic Text Detector (CTD) — khối chữ",
};
const OCR_LABEL: Record<OcrEngine, string> = {
  llm: "AI (LLM vision) — mặc định, tính token",
  manga_ocr: "MangaOCR — chạy local, chỉ tiếng Nhật",
  paddle_ocr: "PaddleOCR — chạy local",
};
const INPAINTER_LABEL: Record<(typeof INPAINTERS)[number], string> = {
  big_lama: "Big LaMa — tổng quát (mặc định)",
  lama_manga: "LaMa manga — huấn luyện cho manga/anime",
};
const TIER_LABEL: Record<(typeof PROOFREAD_TIERS)[number], string> = {
  standard: "Standard (rẻ, nhanh)",
  premium: "Premium (chất lượng cao hơn)",
};

/**
 * Nhãn 2 tầng: tiếng Việt + thuật ngữ gốc; giải thích nằm ở nút "?" (focus được bằng Tab, hover/focus hiện title) và
 * gắn vào ô qua `aria-describedby={tipId(id)}` — tên truy cập của ô chỉ là nhãn, không lẫn cả đoạn giải thích.
 */
const tipId = (id: string) => `${id}-tip`;
function Term(props: { htmlFor: string; vi: string; en: string; tip: string }) {
  return (
    <div className="pipe-label">
      <label htmlFor={props.htmlFor}>
        {props.vi} <span className="pipe-term">{props.en}</span>
      </label>
      <button type="button" className="pipe-tip" title={props.tip} aria-label={`Giải thích: ${props.en}`}>
        ?
      </button>
      <span id={tipId(props.htmlFor)} hidden>
        {props.tip}
      </span>
    </div>
  );
}

function Group(props: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="settings-group">
      <legend>{props.legend}</legend>
      {props.children}
    </fieldset>
  );
}

export function PipelineSettingsForm(props: { value: PipelineSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PipelineSettings>(props.value);
  // Giá trị server đổi (lưu xong, tab khác lưu): chỉ nạp lại khi form chưa sửa dở — không đè chỉnh sửa đang làm.
  const base = useRef(props.value);
  useEffect(() => {
    setF((cur) => (JSON.stringify(cur) === JSON.stringify(base.current) ? props.value : cur));
    base.current = props.value;
  }, [props.value]);
  const [advOpen, setAdvOpen] = useState(false);
  const set = <K extends keyof PipelineSettings>(k: K, v: PipelineSettings[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: (pipeline: PipelineSettings) =>
      api<{ pipeline: PipelineSettings }>("/api/settings/pipeline", { method: "PUT", body: { pipeline } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const dirty = JSON.stringify(f) !== JSON.stringify(props.value);

  return (
    <form
      className="settings-form"
      aria-label="Cài đặt pipeline"
      // Ô nâng cao sai mà mục đang thu → mở ra để trình duyệt chỉ được chỗ lỗi.
      onInvalidCapture={() => setAdvOpen(true)}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(f);
      }}
    >
      <p className="muted small">
        Áp dụng cho mọi series của bạn từ lần chạy sau (Xoá chữ + OCR, xoá chữ lại, OCR vùng tự vẽ, AI hiệu đính).
        Chương đã xử lý không tự chạy lại.
      </p>
      <fieldset disabled={save.isPending} className="pipe-fields">
        <Group legend="Phát hiện chữ">
          <Term
            htmlFor="p-detector"
            vi="Bộ phát hiện chữ"
            en="Text detector"
            tip="Model tìm vị trí chữ trên trang. RT-DETR tìm cả bóng thoại lẫn chữ; CTD tìm khối chữ sát hơn với chữ nhỏ / chữ dọc, bóng thoại vẫn lấy từ RT-DETR."
          />
          <select
            id="p-detector"
            aria-describedby={tipId("p-detector")}
            value={f.detector}
            onChange={(e) => set("detector", e.target.value as never)}
          >
            {TEXT_DETECTORS.map((d) => (
              <option key={d} value={d}>
                {DETECTOR_LABEL[d]}
              </option>
            ))}
          </select>
        </Group>

        <Group legend="Nhận dạng chữ (OCR)">
          <span className="hint">
            Chọn theo ngôn ngữ gốc của series. OCR local không tốn token (không tính vào ngân sách) nhưng không tự nhận
            SFX như AI.
          </span>
          <div className="grid-pairs">
            {SOURCE_LANGS.map((lang) => (
              <div key={lang}>
                <Term
                  htmlFor={`p-ocr-${lang}`}
                  vi={LANG_NAMES[lang]}
                  en="OCR engine"
                  tip="Cách đọc chữ gốc. AI (LLM) đọc tốt mọi ngôn ngữ, nhận SFX, tốn token. MangaOCR chuyên manga tiếng Nhật (cả chữ dọc). PaddleOCR đọc Hàn / Trung / Nhật / Anh, hợp chữ ngang."
                />
                <select
                  id={`p-ocr-${lang}`}
                  aria-describedby={tipId(`p-ocr-${lang}`)}
                  value={f.ocr_engines[lang]}
                  onChange={(e) => set("ocr_engines", { ...f.ocr_engines, [lang]: e.target.value as OcrEngine })}
                >
                  {OCR_ENGINES.filter((o) => ocrEngineSupports(o, lang)).map((o) => (
                    <option key={o} value={o}>
                      {OCR_LABEL[o]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Group>

        <Group legend="Xoá chữ">
          <Term
            htmlFor="p-inpainter"
            vi="Model xoá chữ"
            en="Inpainter"
            tip="Model vẽ lại nền sau khi xoá chữ (nền phẳng luôn tô màu trực tiếp trước). LaMa manga giữ nét screentone / nét vẽ manga tốt hơn; Big LaMa hợp ảnh màu, nền chi tiết."
          />
          <select
            id="p-inpainter"
            aria-describedby={tipId("p-inpainter")}
            value={f.inpainter}
            onChange={(e) => set("inpainter", e.target.value as never)}
          >
            {INPAINTERS.map((m) => (
              <option key={m} value={m}>
                {INPAINTER_LABEL[m]}
              </option>
            ))}
          </select>
        </Group>

        <Group legend="Hiệu đính">
          <Term
            htmlFor="p-proofread"
            vi="Model AI hiệu đính"
            en="AI proofread model"
            tip="Model rà bản dịch cả chương và đề xuất sửa từng khối (không tự ghi đè). Premium chính xác hơn, tốn hơn."
          />
          <select
            id="p-proofread"
            aria-describedby={tipId("p-proofread")}
            value={f.proofread_tier}
            onChange={(e) => set("proofread_tier", e.target.value as never)}
          >
            {PROOFREAD_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </Group>

        <details className="settings-group pipe-adv" open={advOpen} onToggle={(e) => setAdvOpen(e.currentTarget.open)}>
          <summary>Nâng cao</summary>
          <div className="grid-3">
            <div>
              <Term
                htmlFor="p-threshold"
                vi="Ngưỡng tin cậy"
                en="Detection threshold"
                tip={`Điểm tối thiểu để nhận một vùng là chữ (${DETECTION_THRESHOLD.min}–${DETECTION_THRESHOLD.max}). Thấp hơn: bắt thêm chữ nhỏ nhưng dễ nhận nhầm; cao hơn: bỏ sót. Mặc định ${DETECTION_THRESHOLD.default}.`}
              />
              <input
                id="p-threshold"
                aria-describedby={tipId("p-threshold")}
                type="number"
                step="any"
                min={DETECTION_THRESHOLD.min}
                max={DETECTION_THRESHOLD.max}
                required
                value={f.detection_threshold}
                onChange={(e) => set("detection_threshold", Number(e.target.value))}
              />
            </div>
            <div>
              <Term
                htmlFor="p-dilation"
                vi="Nới mask (px)"
                en="Mask dilation"
                tip={`Số px nới rộng vùng xoá quanh nét chữ (${MASK_DILATION.min}–${MASK_DILATION.max}). Để trống = tự động 2–6px theo cỡ chữ. Tăng khi còn viền chữ sót lại.`}
              />
              <input
                id="p-dilation"
                aria-describedby={tipId("p-dilation")}
                type="number"
                step={1}
                min={MASK_DILATION.min}
                max={MASK_DILATION.max}
                placeholder="Tự động"
                value={f.mask_dilation ?? ""}
                onChange={(e) => set("mask_dilation", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div>
              <Term
                htmlFor="p-size"
                vi="Cỡ vùng xoá chữ (px)"
                en="Inpainting size"
                tip={`Cạnh tối đa của một vùng gom chữ đưa vào model xoá chữ (${INPAINT_SIZE.min}–${INPAINT_SIZE.max}, mặc định ${INPAINT_SIZE.default}). Lớn hơn: ít lượt chạy, nhìn được nhiều nền xung quanh nhưng mờ hơn.`}
              />
              <input
                id="p-size"
                aria-describedby={tipId("p-size")}
                type="number"
                step={1}
                min={INPAINT_SIZE.min}
                max={INPAINT_SIZE.max}
                required
                value={f.inpaint_size}
                onChange={(e) => set("inpaint_size", Number(e.target.value))}
              />
            </div>
          </div>
        </details>
      </fieldset>
      <div className="row">
        <button type="submit" className="btn-primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Đang lưu…" : "Lưu cài đặt pipeline"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={JSON.stringify(f) === JSON.stringify(DEFAULT_PIPELINE_SETTINGS)}
          onClick={() => setF(structuredClone(DEFAULT_PIPELINE_SETTINGS))}
        >
          Về mặc định
        </button>
        {save.isSuccess && !dirty && (
          <span className="muted small" role="status">
            Đã lưu.
          </span>
        )}
        {save.isError && (
          <span className="error" role="alert">
            {errorMessage(save.error)}
          </span>
        )}
      </div>
    </form>
  );
}
