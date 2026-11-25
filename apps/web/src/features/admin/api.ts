import {
  type AiSlots,
  type AiTaskSlot,
  MODEL_UNSUPPORTED_MESSAGE,
  type PipelineSettings,
  type ProbeReason,
} from "@mtl/shared";
import { useQuery } from "@tanstack/react-query";
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

export const SLOT_LABEL: Record<AiTaskSlot, string> = { ocr: "Đọc chữ", translate: "Dịch", proofread: "Hiệu đính" };

/** Lỗi API của phần AI → câu tiếng Việt nói rõ việc cần làm. */
export function providerError(e: unknown): string {
  if (!(e instanceof ApiError)) return errorMessage(e);
  const slot = typeof e.body.slot === "string" ? SLOT_LABEL[e.body.slot as AiTaskSlot] : undefined;
  switch (e.body.error) {
    case "secrets_key_missing":
      return "API chưa có SECRETS_KEY nên không lưu / đọc được key. Đặt SECRETS_KEY trong .env của API rồi khởi động lại.";
    case "key_unreadable":
      return "Không giải mã được key đã lưu (SECRETS_KEY đã đổi?). Sửa nhà cung cấp và nhập lại key.";
    case "key_required":
      return "Đổi base URL phải nhập lại API key.";
    case "in_use":
      return slot
        ? `Model đang được dùng cho bước ${slot}. Đổi model của bước đó ở mục Pipeline trước.`
        : "Model đang được dùng cho một bước AI. Đổi model của bước đó ở mục Pipeline trước.";
    case "in_use_by_jobs":
      return `Còn ${String(e.body.jobs ?? "một số")} job đang chạy / chờ dùng nhà cung cấp hoặc model này. Thử lại khi các job xong.`;
    case "duplicate_model":
      return "Model này đã có trong nhà cung cấp.";
    case "model_unsupported":
      return MODEL_UNSUPPORTED_MESSAGE;
    case "model_not_vision":
      return `Bước ${slot ?? ""} cần model có vision (đọc được ảnh).`.replace("  ", " ");
    case "model_not_found":
      return "Model đã chọn không còn tồn tại. Tải lại trang.";
    default:
      return errorMessage(e);
  }
}

/** Kết quả nút "Kiểm tra" → câu cho người dùng. */
export function probeText(r: ProbeResult): string {
  switch (r.reason) {
    case "ok":
      return r.model_found === false
        ? "Kết nối được, key hợp lệ — nhưng chưa thấy model đầu tiên trong danh sách của nhà cung cấp."
        : "Kết nối được, key hợp lệ.";
    case "auth":
      return "Key bị từ chối (sai hoặc hết hiệu lực).";
    case "not_found":
      return "Không tìm thấy endpoint — kiểm tra base URL / tên model.";
    case "quota":
      return "Nhà cung cấp báo hết hạn mức hoặc giới hạn tốc độ (402 / 429).";
    case "network":
      return "Không kết nối được (lỗi mạng hoặc quá 10 giây).";
    case "redirect":
      return "Endpoint chuyển hướng — đổi base URL sang địa chỉ cuối cùng.";
    default:
      return `Phản hồi không rõ${r.http_status ? ` (HTTP ${r.http_status})` : ""}.`;
  }
}
