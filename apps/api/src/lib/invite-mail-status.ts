/**
 * Kết quả lần gửi mail lời mời gần nhất theo invitation id, để UI báo đúng "đã gửi" / "gửi lỗi". Chỉ trong bộ nhớ của
 * tiến trình `mtl-api` (một tiến trình duy nhất, xem docs/deployment-guide.md): mất khi restart → UI nhận `null`
 * ("chưa biết") và dùng câu thận trọng. Giới hạn số mục, bỏ mục cũ nhất.
 */
const MAX_ENTRIES = 500;
const outcomes = new Map<string, boolean>();

export function recordInviteMail(invitationId: string, sent: boolean): void {
  outcomes.delete(invitationId);
  outcomes.set(invitationId, sent);
  if (outcomes.size > MAX_ENTRIES) {
    const oldest = outcomes.keys().next().value;
    if (oldest !== undefined) outcomes.delete(oldest);
  }
}

/** true = gửi được; false = không gửi được / không cấu hình; null = không có ghi nhận (vd API vừa restart). */
export const inviteMailSent = (invitationId: string): boolean | null => outcomes.get(invitationId) ?? null;
