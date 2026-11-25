/**
 * Form nhà cung cấp AI. Thêm: chọn nhà cung cấp + dán key là đủ — tên, model và giá điền sẵn từ gợi ý, chỉnh ở mục
 * "Tuỳ chỉnh" (endpoint tuỳ chỉnh không có gợi ý nên mở sẵn). Sửa: đủ các trường + danh sách model (giá USD / 1M token).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import { adminSettingsKey, type ProvidersResponse, providerError, providersKey } from "./api.ts";
import { REASONING_WARNING, suggestionsFor, unsupportedModelsNote } from "./price-suggestions.ts";
import {
  applySuggestion,
  CHOICE_LABEL,
  choiceOf,
  type DraftErrors,
  diffModels,
  draftOf,
  emptyModel,
  type ModelDraft,
  modelFromSuggestion,
  newDraft,
  PICKER_CHOICES,
  PICKER_LABEL,
  type ProviderDraft,
  pickChoice,
  type SavedProvider,
  toCreateBody,
  toPatchBody,
  validateDraft,
} from "./provider-form-model.ts";

/**
 * Lưu theo thứ tự sửa provider → sửa model → xoá model → thêm model; dừng ở lỗi đầu tiên. So bản nháp với dữ liệu MỚI
 * tải từ server (không phải prop cũ) nên bấm Lưu lại sau lỗi giữa chừng chỉ làm nốt phần còn thiếu.
 */
async function saveEdit(d: ProviderDraft, id: string) {
  const fresh = (await api<ProvidersResponse>("/api/admin/providers")).providers.find((p) => p.id === id);
  if (!fresh) throw new Error("Nhà cung cấp không còn tồn tại. Tải lại trang.");
  const body = toPatchBody(d, fresh);
  if (Object.keys(body).length) await api(`/api/admin/providers/${id}`, { method: "PATCH", body });
  const diff = diffModels(d, fresh);
  for (const p of diff.patch) await api(`/api/admin/models/${p.id}`, { method: "PATCH", body: p.body });
  for (const m of diff.remove) await api(`/api/admin/models/${m.id}`, { method: "DELETE" });
  for (const m of diff.add) await api(`/api/admin/providers/${id}/models`, { method: "POST", body: m });
}

export function ProviderForm(props: { saved?: SavedProvider; secretsConfigured: boolean; onDone(): void }) {
  const { saved } = props;
  const uid = useId();
  const qc = useQueryClient();
  const [d, setD] = useState<ProviderDraft>(() => (saved ? draftOf(saved) : newDraft()));
  const [errors, setErrors] = useState<DraftErrors | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const set = <K extends keyof ProviderDraft>(k: K, v: ProviderDraft[K]) => setD((s) => ({ ...s, [k]: v }));
  const setModel = (i: number, patch: Partial<ModelDraft>) =>
    setD((s) => ({ ...s, models: s.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  const save = useMutation({
    mutationFn: async () => {
      if (saved) await saveEdit(d, saved.id);
      else await api("/api/admin/providers", { method: "POST", body: toCreateBody(d) });
    },
    // Thành công hay lỗi giữa chừng đều tải lại: danh sách phản ánh phần đã lưu.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: providersKey });
      void qc.invalidateQueries({ queryKey: adminSettingsKey });
    },
    onSuccess: props.onDone,
  });

  const choice = choiceOf(d);
  const compat = d.type === "openai_compatible";
  const custom = choice === "openai_compatible";
  const suggestions = suggestionsFor(d.type, d.base_url);
  const field = (name: string) => `${uid}-${name}`;
  // Lỗi nằm trong mục Tuỳ chỉnh đang thu → mở ra cho thấy.
  const advancedError = !!errors && !!(errors.name || errors.no_models || Object.keys(errors.models).length);
  const open = custom || moreOpen || advancedError;

  const nameField = (
    <div>
      <label htmlFor={field("name")}>Tên hiển thị</label>
      <input id={field("name")} value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
      {errors?.name && <span className="error small">{errors.name}</span>}
    </div>
  );
  const urlField = compat && (
    <div className="prov-wide">
      <label htmlFor={field("url")}>Base URL</label>
      <input
        id={field("url")}
        value={d.base_url}
        placeholder="https://api.example.com/v1"
        autoComplete="off"
        onChange={(e) => set("base_url", e.target.value)}
      />
      {errors?.base_url && <span className="error small">{errors.base_url}</span>}
    </div>
  );
  const keyField = (
    <div className="prov-wide">
      <label htmlFor={field("key")}>API key</label>
      <input
        id={field("key")}
        type="password"
        value={d.api_key}
        autoComplete="new-password"
        placeholder={saved ? `Để trống để giữ key ••••${saved.key_last4}` : `Dán API key ${PICKER_LABEL[choice]}`}
        onChange={(e) => set("api_key", e.target.value)}
      />
      {errors?.api_key && <span className="error small">{errors.api_key}</span>}
      {!props.secretsConfigured && (
        <span className="warn-text small">API chưa có SECRETS_KEY — chưa lưu được key.</span>
      )}
    </div>
  );
  const jsonField = compat && (
    <div>
      <label htmlFor={field("json")}>Kiểu JSON</label>
      <select
        id={field("json")}
        value={d.structured_output}
        onChange={(e) => set("structured_output", e.target.value as ProviderDraft["structured_output"])}
      >
        <option value="json_schema">json_schema (mặc định)</option>
        <option value="json_object">json_object (endpoint bỏ qua response_format)</option>
      </select>
      <span className="hint small">Worker tự hạ xuống json_object một lần khi endpoint từ chối json_schema.</span>
    </div>
  );
  const modelsField = (
    <fieldset className="prov-models">
      <legend>Model và giá</legend>
      <span className="hint small">
        Giá tính theo USD / 1 triệu token{choice === "deepseek" ? " (DeepSeek: giá giờ cao điểm)" : ""}.{" "}
        {unsupportedModelsNote(d.type)}
      </span>
      {d.models.length > 0 && (
        <div className="prov-model-row prov-model-head" aria-hidden="true">
          <span>Model id</span>
          <span>Giá vào</span>
          <span>Giá ra</span>
        </div>
      )}
      {d.models.map((m, i) => (
        <div key={m.id ?? i} className="prov-model">
          <div className="prov-model-row">
            <input
              aria-label={`Model ${i + 1}: id`}
              placeholder="model id"
              value={m.model_id}
              readOnly={!!m.id}
              onChange={(e) => setModel(i, { model_id: e.target.value })}
              onBlur={() =>
                setD((s) => ({
                  ...s,
                  models: s.models.map((x, j) => (j === i ? applySuggestion(s.type, x, s.base_url) : x)),
                }))
              }
            />
            <input
              aria-label={`Model ${i + 1}: giá vào`}
              placeholder="giá vào"
              inputMode="decimal"
              value={m.price_in}
              onChange={(e) => setModel(i, { price_in: e.target.value })}
            />
            <input
              aria-label={`Model ${i + 1}: giá ra`}
              placeholder="giá ra"
              inputMode="decimal"
              value={m.price_out}
              onChange={(e) => setModel(i, { price_out: e.target.value })}
            />
            <label className="prov-check">
              <input type="checkbox" checked={m.vision} onChange={(e) => setModel(i, { vision: e.target.checked })} />
              Vision
            </label>
            <label className="prov-check">
              <input
                type="checkbox"
                checked={m.reasoning}
                onChange={(e) => setModel(i, { reasoning: e.target.checked })}
              />
              Reasoning
            </label>
            <button
              type="button"
              className="icon-btn"
              data-danger
              aria-label={`Bỏ model ${m.model_id || i + 1}`}
              title="Bỏ model"
              onClick={() => setD((s) => ({ ...s, models: s.models.filter((_, j) => j !== i) }))}
            >
              <TrashIcon />
            </button>
          </div>
          {m.reasoning && <span className="warn-text small">{REASONING_WARNING}</span>}
          {errors?.models[i] && <span className="error small">{errors.models[i]}</span>}
        </div>
      ))}
      {errors?.no_models && <span className="error small">{errors.no_models}</span>}
      <div className="row">
        <button type="button" onClick={() => set("models", [...d.models, emptyModel()])}>
          + Thêm model
        </button>
        {suggestions
          .filter((s) => !d.models.some((m) => m.model_id.trim() === s.model_id))
          .map((s) => (
            <button
              key={s.model_id}
              type="button"
              className="btn-ghost"
              title={`Gợi ý giá ${s.price_in} / ${s.price_out} USD mỗi 1M token (xác nhận lại với trang giá của ${CHOICE_LABEL[choice]})`}
              onClick={() => set("models", [...d.models, modelFromSuggestion(s)])}
            >
              + {s.model_id}
            </button>
          ))}
      </div>
    </fieldset>
  );

  // Tóm tắt mục Tuỳ chỉnh khi đang thu: tên + model sẽ được thêm.
  const summary = d.models.length ? d.models.map((m) => m.model_id).join(", ") : "chưa có model";

  return (
    <form
      className="prov-form"
      aria-label={saved ? `Sửa ${saved.name}` : "Thêm nhà cung cấp"}
      onSubmit={(e) => {
        e.preventDefault();
        const found = validateDraft(d, saved);
        setErrors(found);
        if (!found) save.mutate();
      }}
    >
      <fieldset disabled={save.isPending} className="pipe-fields">
        {saved ? (
          <>
            <div className="prov-grid">
              <div>
                <label htmlFor={field("type")}>Loại</label>
                <select id={field("type")} value={choice} disabled>
                  <option value={choice}>{CHOICE_LABEL[choice]}</option>
                </select>
              </div>
              {nameField}
              {urlField}
              {keyField}
              {jsonField}
            </div>
            {modelsField}
          </>
        ) : (
          <>
            <div className="prov-picker" role="radiogroup" aria-label="Nhà cung cấp">
              {PICKER_CHOICES.map((c) => (
                <label key={c} className="prov-pick" data-checked={c === choice || undefined}>
                  <input
                    type="radio"
                    name={field("pick")}
                    value={c}
                    checked={c === choice}
                    onChange={() => {
                      setErrors(null);
                      setD((s) => pickChoice(s, c));
                    }}
                  />
                  {PICKER_LABEL[c]}
                </label>
              ))}
            </div>
            {custom && <div className="prov-grid">{urlField}</div>}
            <div className="prov-grid">{keyField}</div>
            <details className="prov-more" open={open} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
              <summary>
                Tuỳ chỉnh tên, model và giá{" "}
                {!open && (
                  <span className="muted small">
                    · {d.name || "chưa đặt tên"} · {summary}
                  </span>
                )}
              </summary>
              <div className="prov-more-body">
                <div className="prov-grid">
                  {nameField}
                  {!custom && urlField}
                  {jsonField}
                </div>
                {modelsField}
              </div>
            </details>
          </>
        )}
      </fieldset>
      <div className="row">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? "Đang lưu…" : saved ? "Lưu" : "Thêm nhà cung cấp"}
        </button>
        <button type="button" onClick={props.onDone} disabled={save.isPending}>
          Huỷ
        </button>
      </div>
      {save.error && (
        <p className="error" role="alert">
          {providerError(save.error)}
        </p>
      )}
    </form>
  );
}
