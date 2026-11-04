# Research: better-auth 1.7.11 admin controls + AES-GCM secrets (2026-11-04)

Method: đọc source dist `better-auth@1.7.11` (đúng bản cài) + đọc code repo + docs chính thức. Docs better-auth KHÔNG gắn version (1 bản "latest") → source dist là nguồn quyết định; docs chỉ để dẫn.
Docs: hooks https://better-auth.com/docs/concepts/hooks · email/password https://better-auth.com/docs/authentication/email-password · admin plugin https://better-auth.com/docs/plugins/admin · rate limit https://better-auth.com/docs/concepts/rate-limit · session/cookie cache https://better-auth.com/docs/concepts/session-management · Node crypto GCM https://nodejs.org/api/crypto.html#class-cipheriv (setAAD/getAuthTag)

## TL;DR
1. Runtime sign-up toggle: `hooks.before` (path `/sign-up/email`) đọc DB. BỎ `disableSignUp`. Rate limit bật vô điều kiện.
2. Khoá user: TỰ LÀM (cột `disabled_at` + `databaseHooks.session.create.before` + `internalAdapter.deleteUserSessions(userId)`). KHÔNG dùng plugin admin.
3. AES-256-GCM: blob `base64( keyId(1B) | iv(12B) | tag(16B) | ct )`, AAD = `ai_provider:<providerId>`. Snippet đã chạy thử (roundtrip OK, AAD sai -> throw).
4. Log: `request-log.ts` đã an toàn (không body/query/header). Chặn key ở: response claim (không bao giờ log), `console.error(err)`, `fail` message từ worker, không lưu key vào `jobs.input`.

---

## 1. Chặn sign-up runtime

### Cơ chế (verified source)
- `api/routes/sign-up.mjs:145`: handler check `disableSignUp` → `APIError BAD_REQUEST code EMAIL_PASSWORD_SIGN_UP_DISABLED`. Đọc từ options lúc khởi động → không đổi runtime.
- `hooks.before` (`api/dispatch.mjs:141`): chạy TRƯỚC handler, mọi endpoint, tự lọc `ctx.path`. Chỉ chạy khi đi qua endpoint (HTTP hoặc `auth.api.*`).
- `databaseHooks.user.create.before` (`db/with-hooks.mjs`): chạy trong `internalAdapter.createUser`, `context` = `tryGetCurrentAuthEndpointContext()` → `undefined` khi gọi ngoài endpoint (script).

### So sánh
| | `hooks.before` /sign-up/email | `databaseHooks.user.create.before` |
|---|---|---|
| Vị trí | trước handler | sau bước tra email trùng |
| Lộ email tồn tại? | KHÔNG (từ chối đồng nhất mọi email) | CÓ: `autoSignIn:false` → email trùng trả 200 generic TRƯỚC khi tới createUser; email mới bị lỗi → oracle (đúng cái comment auth.ts muốn tránh) |
| `create-user.ts` | không bị đụng (không qua endpoint) | phải `if (!ctx) return` mới qua |
| Chặn mọi đường tạo user (social/plugin tương lai) | không | có |
| Mã lỗi | tự chọn | tự chọn |

→ Chọn `hooks.before`. Hiện chỉ có email/password, không social/plugin → đủ. (Có thể thêm `databaseHooks.user.create.before` với `if (ctx) …` sau này nếu thêm OAuth.)

### Mã lỗi client
Web đã map `err.code === "EMAIL_PASSWORD_SIGN_UP_DISABLED"` (`apps/web/src/routes/login.tsx:16`) → GIỮ NGUYÊN code + status 400 để web không đổi.

```ts
import { createAuthMiddleware, APIError } from "better-auth/api";

export const createAuth = ({ isSignupEnabled = defaultIsSignupEnabled }: { isSignupEnabled?: () => Promise<boolean> } = {}) =>
  betterAuth({
    // ...
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: false }, // BỎ disableSignUp
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        if (await isSignupEnabled()) return;
        throw new APIError("BAD_REQUEST", {
          message: "Email and password sign up is not enabled",
          code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
        });
      }),
    },
    rateLimit: { enabled: true, storage: "memory",
      customRules: { "/sign-up/email": { window: 3600, max: 5 }, "/get-session": false } },
  });

// DB row thiếu → fallback env (giữ SIGNUP_ENABLED làm default lần đầu)
const defaultIsSignupEnabled = async () => (await readSetting("signup_enabled")) ?? env.SIGNUP_ENABLED;
```
(`APIError("BAD_REQUEST", {message, code})` — cùng shape plugin admin dùng, `APIError.from(...)` ở dist; docs ví dụ dùng `new APIError`.) Cache DB read: không cần (đăng ký rate-limit 5/giờ/IP; 1 query PK).

### Trả lời các câu
- `create-user.ts` vẫn chạy khi tắt: nó gọi `ctx.internalAdapter.createUser` + `linkAccount`, KHÔNG qua endpoint/hook. Xác nhận bằng code (không dùng `auth.api.signUpEmail`). Bỏ `disableSignUp` KHÔNG ảnh hưởng nó. Thêm 1 test: signup tắt → HTTP 400 code đúng; `createUser()` vẫn OK.
- Có cần bỏ hẳn `disableSignUp`? CÓ. Còn `true` thì handler từ chối trước cả khi DB bật, toggle runtime vô nghĩa. Kể cả `disableSignUp:false` cố định là default.
- Rate limit: bật vô điều kiện (hiện `signupEnabled ? {...} : undefined`). Mặc định better-auth chỉ bật production → dev/test cần `enabled:true` tường minh. Rate limit chạy ở `onRequest` (`api/index.mjs:172`) TRƯỚC `hooks.before` → request bị từ chối vẫn tính vào bộ đếm (vô hại, còn chống dò). Lưu ý: bucket in-memory mất khi restart (đã chấp nhận ở comment hiện tại).
- Refactor test: tham số `signupEnabled: boolean` → `isSignupEnabled: () => Promise<boolean>` (test inject `async () => true/false`).
- RỦI RO phải xử lý: `env.ts` hiện bắt `SIGNUP_ENABLED=true` phải có `GLOBAL_DAILY_USD` + `USER_DAILY_USD`. Toggle runtime vượt qua guard đó. → Endpoint admin bật đăng ký phải từ chối (409) nếu `env.USER_DAILY_USD`/`GLOBAL_DAILY_USD` undefined (cùng thông điệp). Đã ghi vào open Qs: có cho phép bật khi budget cấu hình qua DB sau này không.

---

## 2. Khoá user

### Plugin admin: sự thật từ source (`plugins/admin/schema.mjs`, `admin.mjs`)
- Thêm cột `user.role`, `user.banned` (default false), `user.banReason`, `user.banExpires`, `session.impersonatedBy` → migration Drizzle + sửa `packages/db/src/schema/auth.ts`. `role` `required:false` → không bắt buộc có giá trị, nhưng cột tồn tại; `databaseHooks.user.create.before` của plugin còn GHI `role: "user"` mặc định vào mọi user mới (kể cả qua `create-user.ts`, vì hook áp ở internalAdapter).
- Ban chặn: `databaseHooks.session.create.before` throw `FORBIDDEN code BANNED_USER` (sau khi mật khẩu đúng); `banUser` gọi `deleteUserSessions`. Có sẵn, đúng cái cần.
- Cái kèm theo ngoài ý muốn: ~13 endpoint (`setRole`, `createUser`, `removeUser`, `impersonateUser`, `setUserPassword`, `listUsers`…) mount dưới `/api/auth/admin/*`, quyền xét theo `role` ∈ `adminRoles` hoặc `adminUserIds` (mảng **user id**, không phải email — `has-permission.mjs:4`). `ADMIN_EMAILS` không dùng được trực tiếp → 2 nguồn sự thật (role cột vs env), hoặc phải resolve email→id lúc khởi động (id uuid sinh ở DB, user có thể chưa tồn tại). Admin impersonate = bề mặt tấn công thừa; mọi endpoint này trên cùng origin cookie.
- Client plugin `adminClient` + type inference thay đổi (`AuthSession` thêm field).

### Tự làm (đề xuất)
Cột + 1 hook + 1 lời gọi:
```ts
// packages/db/src/schema/auth.ts : user table
disabledAt: timestamp("disabled_at"),            // + migration drizzle

// auth.ts
user: { additionalFields: { disabledAt: { type: "date", required: false, input: false } } },
databaseHooks: { session: { create: { before: async (session, ctx) => {
  if (!ctx) return;                                   // script/tool ngoài endpoint
  const u = await ctx?.context.internalAdapter.findUserById(session.userId);
  if (u && (u as { disabledAt?: Date | null }).disabledAt)
    throw new APIError("FORBIDDEN", { message: "Account disabled", code: "USER_DISABLED" });
} } } },

// admin route: khoá
await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, id));   // 1) set cờ trước
await (await auth.$context).internalAdapter.deleteUserSessions(id);              // 2) rồi thu hồi session
// mở: set disabledAt = null (không cần gì thêm)
```
- API đúng là `internalAdapter.deleteUserSessions(userId)` (có ở `db/internal-adapter.mjs`, nhận userId). `deleteSessions(tokens)` nhận **token**, không phải userId — đừng nhầm. Xoá thẳng bảng session cũng chạy được nhưng bỏ qua secondaryStorage/hook → dùng API.
- Thứ tự: set cờ → xoá session (đóng cửa sổ race "đăng nhập vừa lọt giữa 2 bước", còn khe nhỏ nếu sign-in đã qua hook trước UPDATE; chấp nhận, hoặc xoá lần 2 sau 1 tick).
- Defense in depth: `requireUser` thêm `if (s.user.disabledAt) throw 403` (nhờ `additionalFields` nên `s.user` có field; `AuthSession` tự cập nhật type).
- Cấm khoá admin (email ∈ ADMIN_EMAILS) và chính mình.
- `findUserById` chỉ trả cột better-auth biết → BẮT BUỘC khai `additionalFields`, nếu không `disabledAt` luôn undefined (hook im lặng không chặn!). Test: khoá → sign-in đúng mật khẩu = 403 `USER_DISABLED`.

### Cookie cache
`auth.ts` KHÔNG bật `session.cookieCache` → mỗi `getSession` đọc DB; xoá session = hiệu lực ngay (request kế tiếp 401). Nếu sau này bật: `getSession` trả user/session từ cookie cho tới `maxAge` mà không hỏi DB (`api/routes/session.mjs:39-48`) → khoá chậm tới maxAge. Cách chữa: `requireUser` gọi `auth.api.getSession({ headers, query: { disableCookieCache: true } })` (param có trong source :48). Ghi comment "không bật cookieCache" tại auth.ts.

### So sánh
| | Plugin admin | Tự làm |
|---|---|---|
| Code | ~0 logic, nhưng schema 5 cột + client plugin | ~15 dòng + 1 cột |
| Endpoint thừa | ~13 (impersonate, setPassword, removeUser) | 0 |
| Xung đột ADMIN_EMAILS | CÓ (role/adminUserIds ≠ email) | Không |
| Ban có hạn (banExpires) | có | không cần (YAGNI) |
| Rủi ro nâng cấp | plugin đổi schema theo version | thấp (hook API ổn từ 1.x) |
Khuyến nghị: tự làm. Adoption risk plugin admin: ổn định, nhưng bề mặt quá rộng so với nhu cầu.

---

## 3. AES-256-GCM (`node:crypto`)

### Định dạng
- Lưu cột `text`: `base64( keyId:1B | iv:12B | tag:16B | ciphertext )`. keyId 1 byte (1..255) = version master key. Lưu thêm provider id ở cột riêng (đã là PK/unique); KHÔNG nhét AAD vào blob (AAD phải do phía giải mã tự dựng lại, nếu không không chống tráo dòng).
- IV 12 byte `randomBytes(12)` mỗi lần mã (chuẩn NIST cho GCM). Random 96-bit an toàn tới ~2^32 lần mã/key — vượt xa nhu cầu (vài key). Không tái dùng IV: mỗi lần user đổi key sinh blob mới.
- AAD = `ai_provider:<providerId>` (có thể thêm `:v1` nếu đổi schema). Tráo ciphertext dòng A sang dòng B → `final()` throw. Verify bằng chạy thử.
- `authTagLength: 16` truyền tường minh lúc decipher (tránh chấp nhận tag ngắn; Node cảnh báo).

### `SECRETS_KEY` + zod
32 byte base64 chuẩn (`openssl rand -base64 32` → 44 ký tự, đuôi `=`). `Buffer.from(x,'base64')` rất dễ dãi (bỏ ký tự lạ) → validate regex strict + độ dài.
```ts
const b64Key32 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "SECRETS_KEY phải là 32 byte base64 (openssl rand -base64 32)")
  .refine((v) => Buffer.from(v, "base64").length === 32);
// trong schema Env:
SECRETS_KEY: b64Key32,                                   // bắt buộc mọi môi trường (test: key cố định trong setup)
SECRETS_KEY_ID: blank(z.coerce.number().int().min(1).max(255).default(1)),
SECRETS_KEY_PREV: blank(b64Key32.optional()),            // chỉ đặt trong lúc xoay
SECRETS_KEY_PREV_ID: blank(z.coerce.number().int().min(1).max(255).optional()),
// superRefine: PREV và PREV_ID đi đôi; PREV_ID !== SECRETS_KEY_ID
```
Không log, không để vào `/health`. Mất key = mất hết API key lưu (khôi phục = nhập lại) — ghi vào deployment-guide: backup key ngoài DB.

### Snippet (đã chạy thử, node 22+)
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Ring = Map<number, Buffer>; // keyId -> 32B
const ring: Ring = new Map([[env.SECRETS_KEY_ID, Buffer.from(env.SECRETS_KEY, "base64")]]);
if (env.SECRETS_KEY_PREV) ring.set(env.SECRETS_KEY_PREV_ID!, Buffer.from(env.SECRETS_KEY_PREV, "base64"));
const CUR = env.SECRETS_KEY_ID;
const aadOf = (providerId: string) => Buffer.from(`ai_provider:${providerId}`, "utf8");

export function encryptSecret(plain: string, providerId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ring.get(CUR)!, iv, { authTagLength: 16 });
  c.setAAD(aadOf(providerId));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([Buffer.from([CUR]), iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(blob: string, providerId: string): string {
  const b = Buffer.from(blob, "base64");
  if (b.length < 1 + 12 + 16) throw new Error("secret blob hỏng");
  const key = ring.get(b[0]!);
  if (!key) throw new Error(`thiếu master key id=${b[0]}`);
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(1, 13), { authTagLength: 16 });
  d.setAAD(aadOf(providerId));
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8"); // throw nếu sai key/AAD/bị sửa
}
export const secretKeyId = (blob: string) => Buffer.from(blob, "base64")[0]!;
```
Thêm: hiển thị cho admin chỉ `••••` + 4 ký tự cuối (lưu `last4` plaintext riêng cột, không giải mã để hiển thị); GET settings KHÔNG bao giờ trả key.

### Xoay master key
1. Sinh key mới K2. Đặt `SECRETS_KEY=K2`, `SECRETS_KEY_ID=2`, `SECRETS_KEY_PREV=K1`, `SECRETS_KEY_PREV_ID=1`. Khởi động lại: đọc blob id=1 (qua PREV), ghi mới id=2.
2. Script `pnpm rotate-secrets`: với mỗi dòng có `secretKeyId(blob) !== CUR` → decrypt → encrypt → UPDATE (1 transaction/dòng). Idempotent.
3. Khi không còn dòng id=1 → bỏ PREV khỏi env.
Không cần re-encrypt lười (lazy) — số dòng nhỏ (YAGNI). Rotation tối đa 2 key cùng lúc là đủ.

---

## 4. Redact log

### `request-log.ts` hiện tại
Chỉ bật khi `NODE_ENV=production`. JSON 1 dòng: `t, level, method, path, status, ms`. KHÔNG log query, header, body, cookie, user id. `c.req.path` không chứa query. → an toàn với api_key trong body/response; không cần sửa. (Path có id job: không bí mật.)

### Chỗ api_key có thể rò (claim response chứa `api_key`)
- `POST /worker/v1/claim` (`routes/worker.ts:47`): response `jobs[]` chứa key. Log truy cập không ghi body → OK. Giữ vậy: KHÔNG thêm body logging vào `requestLog` (ghi comment cảnh báo, hoặc test snapshot: key `body`/`headers` không xuất hiện).
- `app.onError` → `console.error(err)` (`app.ts:58`) và `workerRoutes.onError` ném lại: nếu lỗi nối chuỗi payload (zod issue, `JSON.stringify(job)`) → rò. Quy tắc: lỗi chỉ mang id/code, không nhúng input job. `queue.ts:166` log `err.message` zod của input job: zod message không chứa giá trị, OK nhưng khi thêm `api_key` vào input schema nhớ không dùng `.input`/dump.
- Lưu DB: KHÔNG ghi `api_key` vào `jobs.input`/`jobs.result`/events (bị đọc lại bởi UI, export, log). Inject key lúc trả `claim` (giải mã tại thời điểm claim từ bảng provider), không persist cùng payload. `claim-inputs.ts` là điểm hợp lý (build input lúc claim).
- Worker phía Python: không echo payload vào `fail.message`/stdout/traceback gửi lên API (API lưu `error` của job → hiển thị cho user). Cần review worker (ngoài phạm vi nghiên cứu này, không đọc code worker).
- Cache/proxy: response claim phải `Cache-Control: no-store`; Caddy không log body mặc định (đã xác nhận ở request-log comment, KHÔNG xác nhận Caddyfile — kiểm tra `format` log Caddy không có request body).
- Bảo vệ thêm: pipeline version bump (`MIN_PIPELINE_VERSION`) vì worker cũ không hiểu field `api_key` (schema `additionalProperties:false` như các bump trước) → cần tăng 0.10.0.
- Defense-in-depth tuỳ chọn: helper `redact()` che chuỗi dạng `sk-…`/`AIza…` trong `console.error`. YAGNI trừ khi có sự cố; ưu tiên không-đưa-vào.
- Giới hạn trust: key giờ nằm trong RAM + qua mạng tới worker (Modal) → TLS bắt buộc ở mọi hop.

---

## Xếp hạng khuyến nghị
1. Sign-up: `hooks.before` + DB setting, bỏ `disableSignUp`, rate limit vô điều kiện.
2. Khoá user: tự làm `disabled_at` + hook session.create + `deleteUserSessions`; cấm bật `cookieCache` (hoặc `disableCookieCache` trong `requireUser`).
3. Secrets: AES-256-GCM format trên, key ring 2 slot, AAD theo provider.
4. Log: không đổi `request-log.ts`; inject key lúc claim, không persist; bump MIN_PIPELINE_VERSION.

## Giới hạn nghiên cứu
- Không chạy better-auth thật (chỉ đọc dist 1.7.11) và không chạy test của repo; snippet crypto đã chạy riêng, hook better-auth chưa chạy → cần test tích hợp (ghi trong plan).
- Không đọc code worker Python, Caddyfile, `queue.ts` chi tiết, `claim-inputs.ts`.
- Docs better-auth không versioned; mã lỗi `USER_DISABLED` do mình đặt tên.
- Chưa kiểm `lib/create-user.ts` có bị hook `session.create` ảnh hưởng: không (không tạo session).

## Câu hỏi còn mở
1. Toggle đăng ký runtime có bắt buộc kiểm `USER_DAILY_USD`/`GLOBAL_DAILY_USD` (env) như `SIGNUP_ENABLED` không? (đề xuất: có, 409.)
2. Env `SIGNUP_ENABLED` còn ý nghĩa gì sau khi có row DB: chỉ default lần đầu, hay DB luôn thắng? (đề xuất: DB thắng khi có row.)
3. Khoá user: có cần ngăn khoá theo thời hạn / lý do (ban reason)? (đề xuất: không, YAGNI.)
4. Có kế hoạch bật `cookieCache` (perf) không? Nếu có phải dùng `disableCookieCache` cho `requireUser`.
5. Key AI một-provider-một-key toàn cục hay có key riêng mỗi user? (ảnh hưởng AAD: thêm userId nếu per-user.)
6. Worker Python có sẵn chỗ nhận `api_key` trong claim không, và cách nó báo lỗi có echo payload không? Cần đọc worker.
7. Lưu `SECRETS_KEY` ở đâu trên prod (systemd EnvironmentFile?) và backup thế nào?
