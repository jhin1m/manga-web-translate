/**
 * Snapshot model đã gán cho từng tác vụ AI → `payload.llm` của job (không key). Slot chưa gán không có mặt trong
 * kết quả → worker dùng cấu hình env cho tác vụ đó.
 */
import { aiModels, type DbLike, systemSettings } from "@mtl/db";
import type { AiTaskSlot, LlmRefs } from "@mtl/shared";
import { eq, inArray } from "drizzle-orm";

const SLOT_COLUMNS = {
  ocr: systemSettings.ocrModelId,
  translate: systemSettings.translateModelId,
  proofread: systemSettings.proofreadModelId,
} as const;

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
  const ids = [...new Set([row?.ocr, row?.translate, row?.proofread].filter((v): v is string => !!v))];
  if (ids.length === 0) return {};
  const models = await t
    .select({ id: aiModels.id, providerId: aiModels.providerId, modelId: aiModels.modelId })
    .from(aiModels)
    .where(inArray(aiModels.id, ids));
  const byId = new Map(models.map((m) => [m.id, { provider_id: m.providerId, model: m.modelId }]));
  const out: LlmRefs = {};
  for (const slot of Object.keys(SLOT_COLUMNS) as AiTaskSlot[]) {
    const ref = byId.get(row?.[slot] ?? "");
    if (ref) out[slot] = ref;
  }
  return out;
}

/** Phần `llm` của payload cho các slot job cần; không slot nào được gán → `{}` (payload y như trước). */
export function llmFor(refs: LlmRefs, slots: readonly AiTaskSlot[]): { llm?: LlmRefs } {
  const picked: LlmRefs = {};
  for (const s of slots) {
    const ref = refs[s];
    if (ref) picked[s] = ref;
  }
  return Object.keys(picked).length ? { llm: picked } : {};
}
