import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../lib/api.ts";

export function LoginPage({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (err) return setError(err.message ?? "Sai email hoặc mật khẩu");
    router.history.push(next);
  }

  return (
    <main className="auth">
      <h1>Đăng nhập</h1>
      <form onSubmit={submit}>
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy}>
          Đăng nhập
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      <p className="muted">Chỉ đăng ký được qua link mời của workspace.</p>
    </main>
  );
}
