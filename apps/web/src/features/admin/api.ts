import {
  type AiSlots,
  type AiTaskSlot,
  type PipelineSettings,
  type ProbeReason,
  RECOMMENDED_ANTHROPIC_MODEL,
} from "@mtl/shared";
import { useQuery } from "@tanstack/react-query";
import { t, tp } from "../../i18n/t.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import type { SavedProvider } from "./provider-form-model.ts";

/** `GET /api/admin/settings`: pipeline + model AI của từng bước. Hạn mức / đăng ký chỉ cấu hình qua `.env` của API. */
export type AdminSettings = {
  pipeline: PipelineSettings;
  slots: AiSlots;
};

export const adminSettingsKey = ["admin", "settings"] as const;

export const useAdminSettings = () =>
  useQuery({ queryKey: adminSettingsKey, queryFn: () => api<AdminSettings>("/api/admin/settings") });

export type ProvidersResponse = { providers: SavedProvider[]; secrets_configured: boolean };
export const providersKey = ["admin", "providers"] as const;

export const useProviders = () =>
  useQuery({ queryKey: providersKey, queryFn: () => api<ProvidersResponse>("/api/admin/providers") });

export type ProbeResult = { ok: boolean; reason: ProbeReason; http_status: number | null; model_found?: boolean };

/** Tên bước AI theo ngôn ngữ giao diện (getter: đọc lúc dùng). */
export const SLOT_LABEL: Record<AiTaskSlot, string> = {
  get ocr() {
    return t("admin.api.slot.ocr");
  },
  get translate() {
    return t("admin.api.slot.translate");
  },
  get proofread() {
    return t("admin.api.slot.proofread");
  },
};

const slotLabel = (v: unknown): string | undefined =>
  typeof v === "string" && Object.hasOwn(SLOT_LABEL, v) ? SLOT_LABEL[v as AiTaskSlot] : undefined;

/** Lỗi API của phần AI → câu nói rõ việc cần làm. */
export function providerError(e: unknown): string {
  if (!(e instanceof ApiError)) return errorMessage(e);
  const slot = slotLabel(e.body.slot);
  switch (e.body.error) {
    case "secrets_key_missing":
      return t("admin.api.error.secrets_key_missing");
    case "key_unreadable":
      return t("admin.api.error.key_unreadable");
    case "key_required":
      return t("admin.api.error.key_required");
    case "in_use":
      return slot ? t("admin.api.error.inUseBySlot", { slot }) : t("admin.api.error.in_use");
    case "in_use_by_jobs":
      return typeof e.body.jobs === "number"
        ? tp("admin.api.error.in_use_by_jobs", e.body.jobs)
        : t("admin.api.error.inUseBySomeJobs");
    case "duplicate_model":
      return t("admin.api.error.duplicate_model");
    case "model_unsupported":
      return t("errors.modelUnsupported", { model: RECOMMENDED_ANTHROPIC_MODEL });
    case "model_not_vision":
      return slot ? t("admin.api.error.model_not_vision", { slot }) : t("admin.api.error.modelNotVisionNoSlot");
    case "model_not_found":
      return t("admin.api.error.model_not_found");
    default:
      return errorMessage(e);
  }
}

/** Kết quả nút "Kiểm tra" → câu cho người dùng. */
export function probeText(r: ProbeResult): string {
  switch (r.reason) {
    case "ok":
      return r.model_found === false ? t("admin.api.probe.okModelMissing") : t("admin.api.probe.ok");
    case "auth":
      return t("admin.api.probe.auth");
    case "not_found":
      return t("admin.api.probe.not_found");
    case "quota":
      return t("admin.api.probe.quota");
    case "network":
      return t("admin.api.probe.network");
    case "redirect":
      return t("admin.api.probe.redirect");
    default:
      return r.http_status ? t("admin.api.probe.unknownHttp", { status: r.http_status }) : t("admin.api.probe.unknown");
  }
}
