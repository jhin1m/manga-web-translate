/** AI › Model tác vụ: 3 select OCR / Dịch / Hiệu đính. OCR + Hiệu đính chỉ model có vision. */
import { AI_TASK_SLOTS, type AiSlots, type AiTaskSlot, VISION_SLOTS } from "@mtl/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { adminSettingsKey, providerError, SLOT_LABEL, useAdminSettings, useProviders } from "./api.ts";

const SLOT_TITLE: Record<AiTaskSlot, string> = { ...SLOT_LABEL, ocr: "OCR (đọc chữ)" };
const SLOT_HINT: Record<AiTaskSlot, string> = {
  ocr: "Cần model có vision.",
  translate: "",
  proofread: "Cần model có vision (đối chiếu với ảnh).",
};

function SlotsForm({
  value,
  providers,
}: {
  value: AiSlots;
  providers: NonNullable<ReturnType<typeof useProviders>["data"]>["providers"];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<AiSlots>(value);
  // Giá trị server đổi (lưu xong, xoá model): chỉ nạp lại khi form chưa sửa dở.
  const base = useRef(value);
  useEffect(() => {
    setF((cur) => (JSON.stringify(cur) === JSON.stringify(base.current) ? value : cur));
    base.current = value;
  }, [value]);
  const save = useMutation({
    mutationFn: (slots: AiSlots) =>
      api<{ slots: AiSlots }>("/api/admin/settings/slots", { method: "PUT", body: slots }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminSettingsKey }),
  });
  const dirty = JSON.stringify(f) !== JSON.stringify(value);

  return (
    <form
      className="settings-form"
      aria-label="Model tác vụ"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(f);
      }}
    >
      <fieldset disabled={save.isPending} className="pipe-fields">
        {AI_TASK_SLOTS.map((slot) => {
          const needVision = VISION_SLOTS.includes(slot);
          return (
            <div key={slot}>
              <label htmlFor={`slot-${slot}`}>{SLOT_TITLE[slot]}</label>
              <select
                id={`slot-${slot}`}
                value={f[slot] ?? ""}
                onChange={(e) => setF((s) => ({ ...s, [slot]: e.target.value || null }))}
              >
                <option value="">Mặc định (env worker)</option>
                {providers.flatMap((p) =>
                  p.models
                    .filter((m) => !needVision || m.vision)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {p.name} · {m.model_id}
                      </option>
                    )),
                )}
              </select>
              {SLOT_HINT[slot] && <span className="hint small"> {SLOT_HINT[slot]}</span>}
            </div>
          );
        })}
      </fieldset>
      <div className="row">
        <button type="submit" className="btn-primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Đang lưu…" : "Lưu"}
        </button>
        {save.isSuccess && !dirty && (
          <span role="status" className="muted small">
            Đã lưu.
          </span>
        )}
      </div>
      {save.error && (
        <p className="error" role="alert">
          {providerError(save.error)}
        </p>
      )}
    </form>
  );
}

export function TasksSection() {
  const settings = useAdminSettings();
  const providers = useProviders();
  if (settings.error || providers.error)
    return <p className="error">{providerError(settings.error ?? providers.error)}</p>;
  if (!settings.data || !providers.data) return <p className="muted">Đang tải…</p>;
  return (
    <div className="section-plain">
      <h2>Model tác vụ</h2>
      <p className="muted small">
        Chọn model cho từng tác vụ. "Mặc định" = worker dùng model và key trong biến môi trường của nó. Có hiệu lực từ
        job tạo sau khi lưu.
      </p>
      {providers.data.providers.length === 0 && (
        <p className="muted small">Chưa có nhà cung cấp nào — thêm ở mục Nhà cung cấp.</p>
      )}
      <SlotsForm value={settings.data.slots} providers={providers.data.providers} />
    </div>
  );
}
