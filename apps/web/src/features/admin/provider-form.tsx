/** Form thêm / sửa nhà cung cấp AI + danh sách model (giá USD / 1M token bắt buộc). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../../lib/api.ts";
import { TrashIcon } from "../home/row-icons.tsx";
import { adminSettingsKey, type ProvidersResponse, providerError, providersKey } from "./api.ts";
import { REASONING_WARNING, suggestionsFor, UNSUPPORTED_MODELS_NOTE } from "./price-suggestions.ts";
import {
  applyChoice,
  applySuggestion,
  CHOICE_LABEL,
  choiceOf,
  type DraftErrors,
  diffModels,
  draftOf,
  emptyDraft,
  emptyModel,
  type ModelDraft,
  modelFromSuggestion,
  type ProviderDraft,
  type SavedProvider,
  TYPE_CHOICES,
  type TypeChoice,
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
  const [d, setD] = useState<ProviderDraft>(() => (saved ? draftOf(saved) : emptyDraft()));
  const [errors, setErrors] = useState<DraftErrors | null>(null);
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

  const compat = d.type === "openai_compatible";
  const deepseek = choiceOf(d) === "deepseek";
  const suggestions = suggestionsFor(d.type, d.base_url);
  const field = (name: string) => `${uid}-${name}`;

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
        <div className="prov-grid">
          <div>
            <label htmlFor={field("type")}>Loại</label>
            <select
              id={field("type")}
              value={choiceOf(d)}
              disabled={!!saved}
              onChange={(e) => setD((s) => applyChoice(s, e.target.value as TypeChoice))}
            >
              {TYPE_CHOICES.map((t) => (
                <option key={t} value={t}>
                  {CHOICE_LABEL[t]}
                </option>
              ))}
            </select>
            {deepseek && (
              <span className="hint small">
                Lưu dạng OpenAI-compatible (base URL DeepSeek, JSON kiểu json_object). Giá gợi ý là giá giờ cao điểm.
              </span>
            )}
          </div>
          <div>
            <label htmlFor={field("name")}>Tên hiển thị</label>
            <input id={field("name")} value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
            {errors?.name && <span className="error small">{errors.name}</span>}
          </div>
          {compat && (
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
          )}
          <div className="prov-wide">
            <label htmlFor={field("key")}>API key</label>
            <input
              id={field("key")}
              type="password"
              value={d.api_key}
              autoComplete="new-password"
              placeholder={saved ? `Để trống để giữ key ••••${saved.key_last4}` : ""}
              onChange={(e) => set("api_key", e.target.value)}
            />
            {errors?.api_key && <span className="error small">{errors.api_key}</span>}
            {!props.secretsConfigured && (
              <span className="warn-text small">API chưa có SECRETS_KEY — chưa lưu được key.</span>
            )}
          </div>
          {compat && (
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
              <span className="hint small">
                Worker tự hạ xuống json_object một lần khi endpoint từ chối json_schema.
              </span>
            </div>
          )}
        </div>

        <fieldset className="prov-models">
          <legend>Model và giá</legend>
          <span className="hint small">Giá tính theo USD / 1 triệu token. {UNSUPPORTED_MODELS_NOTE}</span>
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
                  <input
                    type="checkbox"
                    checked={m.vision}
                    onChange={(e) => setModel(i, { vision: e.target.checked })}
                  />
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
                  title={`Gợi ý giá ${s.price_in} / ${s.price_out} USD mỗi 1M token (xác nhận lại với trang giá của ${deepseek ? "DeepSeek" : "OpenAI"})`}
                  onClick={() => set("models", [...d.models, modelFromSuggestion(s)])}
                >
                  + {s.model_id}
                </button>
              ))}
          </div>
        </fieldset>
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
