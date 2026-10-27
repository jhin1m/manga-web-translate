/**
 * Đăng nhập / đăng ký trên cùng trang. Đăng ký xong server không tạo phiên (`autoSignIn: false` — email trùng trả
 * phản hồi như đăng ký mới, không lộ email đã có) → đăng nhập ngay bằng chính email/mật khẩu vừa nhập.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../lib/api.ts";

type Mode = "signin" | "signup";
type AuthError = { status?: number; code?: string; message?: string } | null;

/** Lỗi better-auth → câu cho người dùng. */
function describe(err: NonNullable<AuthError>, mode: Mode): string {
  if (err.status === 429) return "Thử lại sau ít phút.";
  if (err.code === "EMAIL_PASSWORD_SIGN_UP_DISABLED") return "Hiện chưa mở đăng ký.";
  if (err.code === "PASSWORD_TOO_SHORT") return "Mật khẩu cần ít nhất 10 ký tự.";
  if (mode === "signin") return "Sai email hoặc mật khẩu.";
  return err.message || "Không đăng ký được.";
}

export function LoginPage({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (signup) {
        const { error: err } = await authClient.signUp.email({ name: name.trim() || email, email, password });
        if (err) return setError(describe(err, "signup"));
      }
      const { error: err } = await authClient.signIn.email({ email, password });
      if (err) return setError(describe(err, "signin"));
      // Query key không mang id tài khoản → phiên trước hết hạn rồi người khác đăng nhập cùng tab không được thấy
      // dữ liệu cache của tài khoản cũ.
      queryClient.clear();
      router.history.push(next);
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <main className="auth">
      <h1>{signup ? "Đăng ký" : "Đăng nhập"}</h1>
      <form onSubmit={submit}>
        {signup && (
          <>
            <label htmlFor="name">Tên</label>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Mật khẩu</label>
        <input
          id="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          minLength={signup ? 10 : undefined}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy}>
          {signup ? "Đăng ký" : "Đăng nhập"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <p className="muted">
        {signup ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
        <button type="button" className="btn-ghost" onClick={() => switchTo(signup ? "signin" : "signup")}>
          {signup ? "Đăng nhập" : "Đăng ký"}
        </button>
      </p>
    </main>
  );
}
