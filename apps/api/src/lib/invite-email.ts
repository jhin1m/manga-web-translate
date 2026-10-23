/** Nội dung mail lời mời (tiếng Việt). HTML tối giản, mọi giá trị người dùng nhập đều được escape. */
export type InviteEmailInput = {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  link: string;
  expiresAt: Date;
};

const ROLE_VI: Record<string, string> = { owner: "chủ sở hữu", admin: "quản trị viên", member: "thành viên" };
const roleLabel = (role: string) => ROLE_VI[role] ?? role;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(d);

export function inviteEmail(i: InviteEmailInput) {
  const expiry = formatDate(i.expiresAt);
  // Tên workspace/người mời là input người dùng → bỏ xuống dòng để không chèn được header/đoạn giả.
  const ws = i.workspaceName.replace(/\s+/g, " ").trim();
  const inviter = i.inviterName.replace(/\s+/g, " ").trim();
  const role = roleLabel(i.role);
  return {
    to: i.to,
    subject: `${inviter} mời bạn vào workspace "${ws}"`,
    text: [
      `${inviter} mời bạn tham gia workspace "${ws}" với vai trò ${role}.`,
      "",
      `Mở link sau để đăng ký/nhận lời mời (hết hạn ${expiry}):`,
      i.link,
      "",
      "Nếu bạn không mong đợi email này, hãy bỏ qua nó.",
    ].join("\n"),
    html: [
      `<p><strong>${escapeHtml(inviter)}</strong> mời bạn tham gia workspace <strong>${escapeHtml(ws)}</strong> với vai trò <strong>${escapeHtml(role)}</strong>.</p>`,
      `<p><a href="${escapeHtml(i.link)}">Nhận lời mời</a></p>`,
      `<p>Hoặc mở link: ${escapeHtml(i.link)}<br>Hết hạn: ${escapeHtml(expiry)}.</p>`,
      "<p>Nếu bạn không mong đợi email này, hãy bỏ qua nó.</p>",
    ].join("\n"),
  };
}
