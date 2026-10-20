/**
 * Kênh cảnh báo duy nhất: ntfy (POST text tới ALERT_NTFY_URL, tiêu đề/ưu tiên qua header). Không đặt URL → chỉ
 * log. Lỗi gửi không bao giờ ném ra (cảnh báo không được làm hỏng vòng reaper/dispatcher).
 * `infra/alert.sh` dùng cùng kênh cho điều kiện cần quan sát từ ngoài process (healthz, hàng đợi cũ).
 */
import { env } from "../env.ts";

export type AlertPriority = "default" | "high" | "urgent";

export async function sendAlert(title: string, message: string, priority: AlertPriority = "high"): Promise<boolean> {
  console.warn(`[alert] ${title}: ${message}`);
  if (!env.ALERT_NTFY_URL) return false;
  try {
    const res = await fetch(env.ALERT_NTFY_URL, {
      method: "POST",
      body: message,
      // Header HTTP chỉ nhận latin1 → tiêu đề tiếng Việt mã hoá RFC 2047 (ntfy hỗ trợ).
      headers: { title: `=?UTF-8?B?${Buffer.from(`[mtl] ${title}`).toString("base64")}?=`, priority, tags: "mtl" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[alert] ntfy ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[alert] gửi thất bại", err);
    return false;
  }
}
