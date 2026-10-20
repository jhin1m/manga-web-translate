/**
 * Chỉ dev: thử đăng nhập tự động (API chỉ mount route khi bật env, còn lại 404). Gọi sau `import.meta.env.DEV`
 * để build production loại bỏ cả module. Dùng chung 1 promise → mỗi lần tải trang thử đúng 1 lần (kể cả StrictMode).
 * Đã chủ động đăng xuất trong tab → tab đó không tự đăng nhập lại nữa (cờ sessionStorage).
 */
const SIGNED_OUT_KEY = "mtl.dev-signed-out";
let attempt: Promise<boolean> | null = null;

function signedOut(): boolean {
  try {
    return sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDevSignedOut() {
  if (!import.meta.env.DEV) return;
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, "1");
  } catch {
    // bỏ qua
  }
}

export function tryDevLogin(): Promise<boolean> {
  if (!import.meta.env.DEV || signedOut()) return Promise.resolve(false);
  attempt ??= fetch("/api/dev/auto-login", { method: "POST", credentials: "same-origin" }).then(
    (r) => r.ok,
    () => false,
  );
  return attempt;
}
