# Red team: Assumption Destroyer (vai kiểm chứng: Scope Auditor)

Plan: `plans/261104-1237-admin-settings-ai-providers/` (plan.md + phase-01..06). Ngày 2026-11-04. Mọi dẫn chứng đã grep/đọc
trên repo hiện tại (better-auth 1.7.11 trong `node_modules/.pnpm`).

Kết quả Scope Auditor (state mới và vòng đời):

| State mới | Vòng đời | Nơi khởi tạo | Kết luận |
|---|---|---|---|
| `system_settings` (singleton DB) | toàn hệ thống, chung cho mọi process (`mtl-api`, `mtl-jobs`, e2e) | seed ở `apps/api/src/index.ts`, upsert ở admin routes | OK, nhưng các test đọc nó qua route quét (xem F3) |
| `env.ADMIN_EMAILS` (mảng có thể mutate) | singleton của process (`apps/api/src/env.ts:98`) | `parseEnv` lúc import, `seedAdmin` gọi `.push` | FAILED, rò giữa các ca trong cùng file (F8) |
| keyring `SECRETS_KEY` "dựng lười" | singleton module | `lib/secrets.ts` | FAILED, memo hoá ngược với yêu cầu "test đổi env được" (F8) |
| bộ đếm rate limit `memory` của better-auth | singleton module, dùng chung giữa MỌI instance `createAuth()` | `rate-limiter/index.mjs:6` | FAILED, bật vô điều kiện thì làm hỏng bộ test API (F2) |
| cache provider `OrderedDict` ở worker | process worker, 1 luồng xử lý job | `RuntimeDeps` (`worker/mtl_worker/main.py:36`) | OK (handler chạy tuần tự; luồng heartbeat không đụng tới provider) |
| `JobContext.llm` + danh sách scrub | theo từng job | `runner.py` | OK |

---

## Finding 1: Admin xác định bằng email chưa xác minh, đăng ký mở cho phép chiếm email admin chưa có tài khoản, rồi lấy key qua base URL
- **Severity:** Critical
- **Location:** Phase 1, section "Architecture → Admin" và "Risk Assessment" (dòng "user đổi email thành email admin"); Phase 2, section "Requirements" (sửa base URL, "ô trống = giữ key cũ")
- **Flaw:** `isAdminEmail(c.get("user").email)` tin chuỗi email mà không kiểm `emailVerified`. Bảng rủi ro chỉ xét `changeEmail`, bỏ qua đường đăng ký: better-auth không bật `requireEmailVerification`, và D7/D9 mở đăng ký lúc chạy. Phase 2 cho đổi base URL của provider `openai_compatible` mà vẫn giữ key đã lưu.
- **Failure scenario:** `ADMIN_EMAILS=owner@x.com,partner@x.com`, partner chưa tạo tài khoản. Admin bật đăng ký trên UI (phase 4). Kẻ tấn công đăng ký `partner@x.com` (không cần xác minh) và trở thành admin ngay. Từ đó: đọc danh sách email + chi phí của mọi user (phase 5), mở hạn mức, rồi `PATCH /providers/:id` đổi `base_url` sang `https://attacker.example` (host public nên qua được SSRF check) mà giữ key. Bấm "Kiểm tra" là API gửi `Authorization: Bearer <key>` tới máy kẻ tấn công. Job dịch kế tiếp cũng gửi key từ worker.
- **Evidence:** `apps/api/src/auth.ts:21-27` (`emailAndPassword` không có `requireEmailVerification`); `apps/api/src/lib/create-user.ts:21` (`emailVerified: false`, nghĩa là mọi tài khoản đều chưa xác minh); `phase-02...md:24` ("đổi tên/base URL/... đổi key (ô trống = giữ key cũ)"); `phase-01...md` Risk table chỉ có dòng `changeEmail`.
- **Suggested fix:** (a) Trong `hooks.before` của `/sign-up/email`, từ chối email thuộc `ADMIN_EMAILS` (admin chỉ tạo bằng `pnpm create-user`), hoặc chỉ coi là admin khi `user.createdAt` cũ hơn lúc khai báo / có cờ do script đặt. (b) Đổi `base_url` hoặc `type` của provider thì bắt buộc nhập lại key (409 `key_required`). Thêm test cho cả hai.

## Finding 2: Bật rate limit vô điều kiện làm gate API test đỏ (luật mặc định `/sign-in*` 3 lần/10 giây, dùng chung 1 bucket khi không có IP)
- **Severity:** High
- **Location:** Phase 4, section "Architecture → Đăng ký" (`rateLimit` luôn `enabled: true`) và "Risk Assessment" (dòng "Chỉ rule `/sign-up/email` chặt")
- **Flaw:** Plan cho rằng chỉ `/sign-up/email` bị giới hạn chặt. Thực tế better-auth có luật đặc biệt mặc định cho mọi path `/sign-in*`, `/sign-up*`, `/change-password*` là `window: 10, max: 3`. Request không có IP tin cậy thì rơi vào **một bucket chung** `no-trusted-ip`. Bộ đếm nằm trong `Map` cấp module, nên mọi instance `createAuth()` trong cùng process dùng chung. Hiện test API chạy được là nhờ `SIGNUP_ENABLED=false`, khi đó `rateLimit: undefined` và better-auth mặc định tắt rate limit ngoài production.
- **Failure scenario:** Sau phase 4, `helpers.call()` (không gửi `x-real-ip`) đăng nhập lần thứ 4 trong 10 giây thì nhận 429, và `signIn` ném `sign-in ... failed: 429`. Các file `chapters.test.ts` (7 lần seedUser/signIn), `queue.test.ts` (4), `user-quota.test.ts` (4), cộng thêm các file phase 5 gọi `seedAdmin` + `signIn` sau khi khoá, đều đỏ. E2E (SIGNUP_ENABLED đã true) gom thêm 3 lần đăng ký mới (phase 1, 4, 5) vào bucket chung 5 lần/giờ của `/sign-up/email`, nên chỉ cần thêm 1 spec là chạm 429.
- **Evidence:** `node_modules/.pnpm/better-auth@1.7.11.../dist/api/rate-limiter/index.mjs:6` (`const memory = new Map()` cấp module), `:241-246` (không có IP thì dùng `NO_TRUSTED_IP_KEY`), `:293-301` (`getDefaultSpecialRules`: `/sign-in` 10s/3); `apps/api/src/auth.ts:33` (`rateLimit: signupEnabled ? … : undefined`); `apps/api/vitest.config.ts:6` (`SIGNUP_ENABLED: "false"`); `apps/api/test/helpers.ts:15-24` (không gửi `x-real-ip`).
- **Suggested fix:** Giữ rate limit tắt khi `NODE_ENV=test`, hoặc trong `customRules` đặt `"/sign-in/email"` thành rule rõ ràng và cho `helpers.call` gửi `x-real-ip` ngẫu nhiên theo từng user. Thêm Tests Before chạy `pnpm --filter @mtl/api test` với rate limit bật để thấy lỗi trước khi refactor. Sửa dòng Risk cho đúng.

## Finding 3: Giả định "route admin không lẫn vào test cách ly user" là sai, `tenant-isolation` quét `app.routes` của cả app
- **Severity:** High
- **Location:** Phase 1, section "Architecture → Mount"; "Related Code Files" (chỉ sửa `tenant-isolation.test.ts:287`)
- **Flaw:** Plan viết: "Không đưa vào `userApi()` → `tenant-isolation.test.ts:272` (quét `userApi` routes) không bị lẫn route admin". Hàm `userRoutes()` thật ra duyệt `app.routes` của `createApp()`, chỉ bỏ `/api/auth/` và `/api/dev/`. `/api/admin/*` mount trong `createApp` nên vẫn bị quét.
- **Failure scenario:** Từ phase 2, các route có tham số như `PATCH /api/admin/providers/:id`, `DELETE /api/admin/models/:id`, `POST /api/admin/users/:id/disable` (phase 5) và `DELETE /api/admin/fonts/:fontId` (phase 6) làm ca "(b) every route with a resource id has a cross-user case" fail, vì chúng không có trong `RESOURCE_CASES`. Người implement sẽ phải chọn giữa thêm ca 404 vô nghĩa cho route admin và vá test giữa chừng, không có hướng dẫn.
- **Evidence:** `apps/api/test/tenant-isolation.test.ts:270-277` (`for (const r of app.routes)`, chỉ lọc `/api/auth/`, `/api/dev/`), `:302-305` (ca (b) đòi mọi route `:param` phải có trong `RESOURCE_CASES`); `apps/api/test/helpers.ts:9` (`app = createApp()`).
- **Suggested fix:** Phase 1 thêm `r.path.startsWith("/api/admin/")` vào bộ lọc của `userRoutes()`, kèm comment "route admin xuyên user, kiểm ở admin-access.test.ts". Ghi thay đổi này vào Related Code Files. Sửa câu sai trong Architecture.

## Finding 4: D5 "bỏ tier" chưa đủ, "Model dịch: Standard/Premium" của series vẫn còn và làm sai lệch sau khi có slot Dịch
- **Severity:** Medium
- **Location:** Phase 3, section "Hợp đồng (packages/shared)" và "Related Code Files" (chỉ bỏ `proofread_tier`); plan.md D5
- **Flaw:** D5 chốt dùng 3 slot và bỏ tier Standard/Premium. Plan chỉ gỡ `proofread_tier`/`model_tier`. Series vẫn có select "Model dịch" Standard/Premium (`llm_tier`). Trường này không đi tới worker (không job/worker nào đọc `llm_tier`) nhưng có tham gia `translationChanged`, nên đổi nó sẽ tăng `settings_rev`.
- **Failure scenario:** Admin gán slot Dịch = `gpt-4.1-mini`. User chọn "Premium (chất lượng cao hơn)" ở series, tưởng mình được model tốt hơn. `settings_rev` tăng nên bản dịch cũ bị coi là lỗi thời, user dịch lại và trả tiền cho đúng model cũ. Không có test nào bắt được chuyện này.
- **Evidence:** `apps/web/src/features/series/series-settings-form.tsx:209-216` (select "Model dịch", option Premium); `apps/api/src/routes/series.ts:50,232,247` (zod `llm_tier`, ghi, đưa vào `translationChanged`); grep `llm_tier|llmTier` trong `apps/api/src/jobs`, `packages/shared/src/job.ts`, `worker/mtl_worker` không có kết quả nào; `packages/db/src/schema/app.ts:78`.
- **Suggested fix:** Phase 3 gỡ select `llm_tier` khỏi `series-settings-form.tsx` và bỏ `llmTier` khỏi `translationChanged`, giữ cột DB và giá trị API cho tương thích. Thêm test API: PATCH `llm_tier` không tăng `settings_rev`.

## Finding 5: Phase 6 bỏ sót chỗ chọn font trong editor và chỗ đếm giới hạn ở form series, test e2e 12 không thể pass như mô tả
- **Severity:** High
- **Location:** Phase 6, section "Architecture → Web" ("editor ... tự nạp"), "Related Code Files", "Tests After" bước 12
- **Flaw:** Plan cho rằng editor tự hiện font hệ thống vì `use-chapter-session.ts:469` gọi `fetchFonts`. Nhưng `loadFonts` chỉ giữ `{id, name}` trong `FontKit.custom` (mất cờ `system`), và select font của editor gom mọi font đó dưới nhóm cố định "Font của bạn". Ngoài ra form series truyền `custom.data.length` (lúc này gồm cả font hệ thống) vào kiểm tra giới hạn 20 font phía client.
- **Failure scenario:** (1) Editor hiện font hệ thống trong nhóm "Font của bạn", nên e2e bước 12 ("editor hiện tên trong nhóm Font hệ thống") fail, hoặc người implement phải sửa những file không có trong plan. (2) Admin upload 20 font hệ thống (plan cho tối đa 50). Mọi user bấm "+ Tải font lên…" ở form series đều bị chặn với lỗi "Mỗi tài khoản tối đa 20 font" dù chưa có font riêng nào.
- **Evidence:** `apps/web/src/features/editor/fonts.ts:190` (`custom: [...].map((f) => ({ id: f.id, name: f.name }))`); `apps/web/src/features/editor/panels/Properties.tsx:168-175` (`<optgroup label="Font của bạn">`); `apps/web/src/features/chapter/select-panel.tsx:168`; `apps/web/src/features/series/series-settings-form.tsx:119` (`uploadCheckedFont(file, custom.data?.length ?? 0)`); `apps/web/src/features/fonts/api.ts:54`. Grep `Properties` trong các file plan không có kết quả.
- **Suggested fix:** Thêm vào Modify: `editor/fonts.ts` (giữ cờ `system` trong `FontKit`), `editor/panels/Properties.tsx` (2 optgroup), `series-settings-form.tsx:119` (đếm `!system`). Thêm unit test `fontUploadError` với danh sách có font hệ thống.

## Finding 6: Khoá user giả định "401 thì web tự về login", nhưng web không xử lý 401 từ `api()`
- **Severity:** Medium
- **Location:** Phase 5, section "Data flow" và "Tests After" bước 8 (e2e "trang của tài khoản đó về login")
- **Flaw:** Plan chỉ thêm nhánh 403 `user_disabled` vào `api()`. Sau khi admin khoá, `deleteUserSessions` làm request kế tiếp trả 401. `api()` ném `ApiError` cho mọi status không ok, không redirect. `AuthGate` chỉ đổi màn khi `authClient.useSession()` refetch, mà việc này không bị 401 của `/api/*` kích hoạt.
- **Failure scenario:** User bị khoá vẫn ở editor, mọi thao tác báo lỗi "unauthenticated" cho tới khi tự reload hoặc tab nhận focus lại. E2E bước 8 dùng context thứ hai không có sự kiện focus, nên chờ hoài và timeout hoặc chập chờn. Tiêu chí "session hiện tại 401/403 ngay" chỉ đúng ở phía API.
- **Evidence:** `apps/web/src/lib/api.ts:52-55` (không có nhánh 401); `apps/web/src/app/layout.tsx:12,30` (`authClient.useSession()` quyết định có hiện LoginPage hay không); `phase-05...md:53` ("getSession không thấy session → 401 → web về login").
- **Suggested fix:** Trong `api()`, 401 (và 403 `user_disabled`) thì gọi `authClient.$store.notify("$sessionSignal")` hoặc `signOut()` rồi chuyển về `/login`. Thêm unit test cho `api()` và một e2e có `page.reload()` tường minh nếu vẫn giữ hành vi lười.

## Finding 7: Phase 1 bỏ sót consumer của route/màn bị xoá hoặc đổi: test và e2e sẽ đỏ
- **Severity:** Medium
- **Location:** Phase 1, section "Related Code Files" và "Requirements" (xoá `PUT /api/settings/pipeline`, đổi tiêu đề/link "Cài đặt chung")
- **Flaw:** Danh sách Modify không gồm mọi nơi gọi tới. `translate-chain.test.ts` đang PUT route sẽ bị xoá. `fonts.spec.ts` mở trang font qua link "Cài đặt chung" trong menu và chờ heading "Cài đặt chung" (dòng 26-29, plan chỉ ghi `:57,111`). Form pipeline sau khi lưu chỉ invalidate `["me"]`, không invalidate `["admin","settings"]`, nên giá trị cũ còn trong cache.
- **Failure scenario:** `translate-chain.test.ts` nhận 404 ở bước dựng cài đặt, ca test fail. `fonts.spec.ts` không tìm thấy link "Cài đặt chung" (đã đổi thành "Font của tôi"/"Cài đặt"), timeout. Admin lưu pipeline, chuyển mục rồi quay lại thì form hiện giá trị cũ trong 60 giây.
- **Evidence:** `apps/api/test/translate-chain.test.ts:119` (`call("/api/settings/pipeline", …)`); `apps/web/e2e/fonts.spec.ts:26-29`; `apps/web/src/features/pipeline/pipeline-settings.tsx:87` (`invalidateQueries({ queryKey: ["me"] })`); `apps/web/src/app/app-shell.tsx:14` (`staleTime: 60_000`).
- **Suggested fix:** Thêm `apps/api/test/translate-chain.test.ts`, `apps/web/e2e/fonts.spec.ts:26-29` vào Modify. `pipeline-settings.tsx` invalidate `["admin","settings"]`. Chạy `grep -rn "/api/settings/pipeline\|Cài đặt chung" apps` làm bước kiểm tra trong Regression Gate.

## Finding 8: State cấp process mâu thuẫn với cách test dựa vào nó (keyring "lười", `env.ADMIN_EMAILS.push`)
- **Severity:** Medium
- **Location:** Phase 2, section "Secrets" ("Keyring dựng lười (test đổi env được)"); Phase 1, section "Related Code Files" (`seedAdmin` = `env.ADMIN_EMAILS.push`) và "Tests After" bước 11(c)
- **Flaw:** (a) Keyring dựng lười một lần rồi memo hoá là singleton module. Như vậy test đổi `env.SECRETS_KEY`/`SECRETS_KEY_ID` giữa các ca (thiếu key thì 409; PREV id 1 khi key hiện tại id 2; script xoay) sẽ vẫn đọc keyring cũ. Hai yêu cầu "lười" và "test đổi env được" loại trừ nhau, trừ khi dựng lại mỗi lần gọi hoặc có `resetKeyring()`. (b) `env` là object duy nhất của process (`env.ts:98`). `seedAdmin` push vào mảng đã qua transform nhưng không gỡ ra, nên mọi ca sau trong cùng file thấy thêm admin. Ca (c) "email viết hoa/khoảng trắng" không đi qua transform lowercase/trim nếu push trực tiếp, nên chỉ pass khi `isAdminEmail` tự chuẩn hoá phần tử, điều plan không nói.
- **Failure scenario:** `secrets.test.ts` đặt `SECRETS_KEY_ID=2` sau khi ca trước đã dựng keyring id 1, blob mới vẫn mang keyId 1, test "giải mã PREV" pass sai hoặc fail ngẫu nhiên tuỳ thứ tự. `admin-users.test.ts` có ca "khoá email admin → 409" và ca "khoá user thường" bị đổi kết quả nếu email user thường trùng một email đã push trước đó (uniq nên hiếm), còn ca (c) fail chắc chắn.
- **Evidence:** `apps/api/src/env.ts:98` (`export const env: Env = parseEnv(process.env)`); `apps/api/vitest.config.ts:10` (`fileParallelism: false`, các ca trong cùng file chia sẻ module); `phase-02...md:61`; `phase-01...md:122-123,158-160`.
- **Suggested fix:** `getKeyring()` tính lại theo chữ ký `(SECRETS_KEY, SECRETS_KEY_ID, PREV…)` (cache theo khoá đó), không memo vô điều kiện. `isAdminEmail` trim + lowercase cả hai phía. `seedAdmin` trả hàm `restore()` hoặc test dùng `afterEach` để khôi phục `env.ADMIN_EMAILS`.

## Finding 9: Tham chiếu payload theo chuỗi model khiến sửa/xoá model trên UI làm hỏng hàng loạt job đang chờ (lỗi kết thúc, không thử lại)
- **Severity:** Medium
- **Location:** Phase 2, section "Requirements"/"Routes" (`PATCH /models/:id`, chặn 409 chỉ khi xoá hoặc đổi vision); Phase 3, section "API → llm-config.ts" và "Requirements" (job `failed invalid_input`)
- **Flaw:** Payload lưu `{provider_id, model}` theo chuỗi. `resolveLlmConfigs` join `(provider_id, model)` lúc claim. Phase 2 cho `PATCH /models/:id` sửa `model_id` của model **đang gán slot** mà không chặn (409 chỉ áp cho xoá và `vision`). Quy trình xoá ("gỡ slot trước rồi xoá") cũng không kiểm job còn tham chiếu. Lỗi giải mã/thiếu provider đều đi nhánh `terminal(..., "invalid_input")`, tức lỗi cấu hình của admin bị xử lý như dữ liệu của user hỏng.
- **Failure scenario:** Admin sửa lỗi chính tả `gpt-4.1-mini` thành `gpt-4.1-mini-2025…` lúc 30 chương của nhiều user đang chờ. Mọi job đó fail `invalid_input` "provider/model đã bị xoá", trang bị đánh `failed`, user phải tự bấm thử lại từng chương. Một lần quên `SECRETS_KEY_PREV` khi xoay key cũng gây hiệu ứng tương tự trên toàn hàng đợi (plan có ghi "Thấp × Cao" nhưng chưa có cách giảm thiểu nào ngoài cảnh báo lúc boot).
- **Evidence:** `apps/api/src/jobs/queue.ts:166-176` (lỗi trong `try` thì `terminal(t, job, "failed", "invalid_input", …)`); `phase-02...md:27,85` (`PATCH /models/:id` không có guard); `phase-03...md:293-295` (`throw` khi thiếu ref hoặc giải mã lỗi).
- **Suggested fix:** Chặn đổi `model_id` (chỉ cho xoá + thêm mới) hoặc 409 khi có job `queued|running` tham chiếu `(provider_id, model)`. Ref mất ở claim thì rơi về slot hiện tại hoặc env thay vì fail. Lỗi giải mã thì để job ở `queued` + mở breaker + `sendAlert` thay vì kết thúc.

---

Câu hỏi chưa giải quyết:
- Product có muốn cho phép đăng ký bằng email nằm trong `ADMIN_EMAILS` không, hay admin chỉ được tạo bằng `pnpm create-user`? (Quyết định này ảnh hưởng cách sửa F1.)
- Có cần giữ `series.llm_tier` cho một tính năng tương lai không, hay gỡ hẳn theo D5?
