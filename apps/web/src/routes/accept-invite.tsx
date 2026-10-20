import { type FormEvent, useState } from "react";
import { authClient, errorMessage, INVITATION_HEADER, INVITATION_TOKEN_HEADER, navigate } from "../lib/api.ts";

/** /accept-invite?id=<invitationId>&token=<t>: đăng ký (hoặc đăng nhập nếu đã có tài khoản) rồi nhận lời mời. */
export function AcceptInvitePage() {
  const params = new URLSearchParams(location.search);
  const invitationId = params.get("id") ?? "";
  const token = params.get("token") ?? "";
  const { data: session } = authClient.useSession();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    const { data, error: err } = await authClient.organization.acceptInvitation({ invitationId });
    if (err) throw err;
    navigate(`/w/${data?.invitation.organizationId ?? ""}`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!session) {
        const { error: err } =
          mode === "signup"
            ? await authClient.signUp.email({
                name,
                email,
                password,
                fetchOptions: { headers: { [INVITATION_HEADER]: invitationId, [INVITATION_TOKEN_HEADER]: token } },
              })
            : await authClient.signIn.email({ email, password });
        if (err) throw err;
      }
      await accept();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!invitationId || !token) {
    return (
      <main>
        <h1>Lời mời không hợp lệ</h1>
        <p className="muted">Link thiếu mã lời mời hoặc token. Hãy xin lại link từ quản trị workspace.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Nhận lời mời vào workspace</h1>
      <form onSubmit={submit}>
        {session ? (
          <p>
            Đang đăng nhập: <strong>{session.user.email}</strong>
          </p>
        ) : (
          <>
            {mode === "signup" && (
              <>
                <label htmlFor="name">Tên hiển thị</label>
                <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </>
            )}
            <label htmlFor="email">Email được mời</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">Mật khẩu {mode === "signup" && "(≥ 10 ký tự)"}</label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "signup" ? 10 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        <button type="submit" disabled={busy}>
          {session ? "Nhận lời mời" : mode === "signup" ? "Tạo tài khoản và tham gia" : "Đăng nhập và tham gia"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      {!session && (
        <p className="muted">
          <button type="button" className="link" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
          </button>
        </p>
      )}
    </main>
  );
}
