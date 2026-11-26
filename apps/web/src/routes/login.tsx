/**
 * Đăng nhập / đăng ký trên cùng trang. Đăng ký xong server không tạo phiên (`autoSignIn: false` — email trùng trả
 * phản hồi như đăng ký mới, không lộ email đã có) → đăng nhập ngay bằng chính email/mật khẩu vừa nhập.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t, useT } from "../i18n/t.ts";
import { authClient } from "../lib/api.ts";

type Mode = "signin" | "signup";
type AuthError = { status?: number; code?: string; message?: string } | null;

const disabledText = () => t("routes.login.disabled");

/** Lỗi better-auth → câu cho người dùng. */
function describe(err: NonNullable<AuthError>, mode: Mode): string {
  if (err.status === 429) return t("routes.login.rateLimited");
  if (err.code === "EMAIL_PASSWORD_SIGN_UP_DISABLED") return t("routes.login.signupClosed");
  if (err.code === "USER_DISABLED") return disabledText();
  if (err.code === "PASSWORD_TOO_SHORT") return t("routes.login.passwordTooShort");
  if (mode === "signin") return t("routes.login.wrongCredentials");
  return err.message || t("routes.login.signupFailed");
}

export function LoginPage({ next = "/", reason }: { next?: string; reason?: "disabled" }) {
  useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(reason === "disabled" ? disabledText() : null);
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
      <h1>{signup ? t("routes.login.signUp") : t("routes.login.signIn")}</h1>
      <form onSubmit={submit}>
        {signup && (
          <>
            <label htmlFor="name">{t("routes.login.name")}</label>
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
        <label htmlFor="password">{t("routes.login.password")}</label>
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
          {signup ? t("routes.login.signUp") : t("routes.login.signIn")}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <p className="muted">
        {signup ? t("routes.login.haveAccount") : t("routes.login.noAccount")}{" "}
        <button type="button" className="btn-ghost" onClick={() => switchTo(signup ? "signin" : "signup")}>
          {signup ? t("routes.login.signIn") : t("routes.login.signUp")}
        </button>
      </p>
    </main>
  );
}
