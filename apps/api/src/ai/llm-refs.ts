/**
 * Snapshot model của từng tác vụ AI → `payload.llm` của job (không key). Slot admin gán thì dùng model đó; slot để
 * "Tự động" lấy `autoSlotModel` trên các nhà cung cấp đã thêm. Không có model nào → slot vắng mặt → worker dùng cấu
 * hình env cho tác vụ đó.
 */
import { aiModels, aiProviders, type DbLike, systemSettings } from "@mtl/db";
import { AI_TASK_SLOTS, type AiTaskSlot, autoSlotModel, type LlmRefs } from "@mtl/shared";
import { asc, eq } from "drizzle-orm";

const SLOT_COLUMNS = {
  ocr: systemSettings.ocrModelId,
  translate: systemSettings.translateModelId,
  proofread: systemSettings.proofreadModelId,
} as const;

/** Mọi nhà cung cấp + model theo thứ tự thêm (cùng thứ tự danh sách ở Cài đặt › Nhà cung cấp). */
async function providersInOrder(t: DbLike) {
  const rows = await t
    .select({
      providerId: aiProviders.id,
      type: aiProviders.type,
      id: aiModels.id,
      model_id: aiModels.modelId,
      vision: aiModels.vision,
    })
    .from(aiProviders)
    .innerJoin(aiModels, eq(aiModels.providerId, aiProviders.id))
    .orderBy(asc(aiProviders.createdAt), asc(aiProviders.id), asc(aiModels.createdAt), asc(aiModels.id));
  const out: { id: string; type: string; models: typeof rows }[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last?.id === r.providerId) last.models.push(r);
    else out.push({ id: r.providerId, type: r.type, models: [r] });
  }
  return out;
}

/**
 * Đọc 3 slot dưới `FOR SHARE` (tuần tự với đổi slot / xoá provider / model, vốn khoá hàng cài đặt `FOR UPDATE`):
 * ref chụp ra luôn trỏ tới model còn tồn tại tại thời điểm commit enqueue.
 */
export async function slotRefs(t: DbLike): Promise<LlmRefs> {
  const [row] = await t
    .select({
      ocr: SLOT_COLUMNS.ocr,
      translate: SLOT_COLUMNS.translate,
      proofread: SLOT_COLUMNS.proofread,
    })
    .from(systemSettings)
    .where(eq(systemSettings.id, 1))
    .for("share");
  const providers = await providersInOrder(t);
  const out: LlmRefs = {};
  for (const slot of AI_TASK_SLOTS) {
    const assigned = row?.[slot];
    const pick = assigned
      ? providers.flatMap((p) => p.models).find((m) => m.id === assigned)
      : autoSlotModel(providers, slot)?.model;
    if (pick) out[slot] = { provider_id: pick.providerId, model: pick.model_id };
  }
  return out;
}

/** Phần `llm` của payload cho các slot job cần; không slot nào có model → `{}` (payload y như trước). */
export function llmFor(refs: LlmRefs, slots: readonly AiTaskSlot[]): { llm?: LlmRefs } {
  const picked: LlmRefs = {};
  for (const s of slots) {
    const ref = refs[s];
    if (ref) picked[s] = ref;
  }
  return Object.keys(picked).length ? { llm: picked } : {};
}
