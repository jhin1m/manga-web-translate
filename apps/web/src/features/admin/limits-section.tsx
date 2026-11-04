/** Hệ thống › Hạn mức & đăng ký: 2 ô USD/ngày (trống = theo env), bật/tắt đăng ký, chi tiêu hôm nay. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { type AdminSettings, adminSettingsKey, useAdminSettings } from "./api.ts";
import { type ConfirmRequired, canEnableSignup, confirmWarnings, fmtUsd, parseUsd, usdText } from "./limits-model.ts";

type Body = {
  user_daily_usd: number | null;
  global_daily_usd: number | null;
  signup_enabled: boolean | null;
  confirm?: boolean;
};

const envHint = (n: number | null) => (n === null ? "env: không đặt" : `env: ${fmtUsd(n)}`);

function LimitsForm({ data }: { data: AdminSettings }) {
  const qc = useQueryClient();
  const { limits, effective, env, today } = data;
  const [user, setUser] = useState(usdText(limits.user_daily_usd));
  const [global, setGlobal] = useState(usdText(limits.global_daily_usd));
  // `null` = chưa chạm toggle → giữ nguyên giá trị lưu (null = theo env).
  const [signup, setSignup] = useState<boolean | null>(limits.signup_enabled);
  const [pending, setPending] = useState<{ body: Body; warnings: string[] } | null>(null);

  const save = useMutation({
    mutationFn: (body: Body) => api("/api/admin/settings/limits", { method: "PUT", body }),
    onSuccess: async () => {
      setPending(null);
      await qc.invalidateQueries({ queryKey: adminSettingsKey });
      // Hạn mức hiệu lực hiện ở menu avatar ("Hạn mức AI hôm nay").
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e, body) => {
      if (e instanceof ApiError && e.body.error === "confirm_required") {
        const warnings = confirmWarnings(e.body as unknown as ConfirmRequired, {
          user: body.user_daily_usd ?? env.user_daily_usd,
          global: body.global_daily_usd ?? env.global_daily_usd,
        });
        setPending({ body, warnings });
      } else {
        // Lỗi thật (500, mạng, …) sau "Vẫn lưu": đóng hộp xác nhận để thấy lỗi và sửa lại form.
        setPending(null);
      }
    },
  });

  const u = parseUsd(user);
  const g = parseUsd(global);
  const invalid = u === "invalid" || g === "invalid";
  const signupOn = signup ?? effective.signup_enabled;
  const mayEnable = canEnableSignup(user, global, env);
  const body: Body | null = invalid ? null : { user_daily_usd: u, global_daily_usd: g, signup_enabled: signup };
  const dirty = u !== limits.user_daily_usd || g !== limits.global_daily_usd || signup !== limits.signup_enabled;
  const blocked = signupOn && !mayEnable;

  const message = (e: unknown) =>
    e instanceof ApiError && e.body.error === "limits_required"
      ? "Bật đăng ký cần đặt cả hạn mức mỗi người và ngân sách ngày (ở đây hoặc trong env)."
      : errorMessage(e);

  return (
    <form
      className="settings-form"
      aria-label="Hạn mức và đăng ký"
      onSubmit={(e) => {
        e.preventDefault();
        if (body) save.mutate(body);
      }}
    >
      <fieldset disabled={save.isPending || pending !== null} className="pipe-fields">
        <div>
          <label htmlFor="lim-user">Hạn mức mỗi người (USD / ngày UTC)</label>
          <input
            id="lim-user"
            inputMode="decimal"
            value={user}
            placeholder={envHint(env.user_daily_usd)}
            aria-invalid={u === "invalid"}
            onChange={(e) => setUser(e.target.value)}
          />
          <span className="hint small"> Trống = theo env. 0 = chặn mọi job AI.</span>
        </div>
        <div>
          <label htmlFor="lim-global">Ngân sách ngày toàn hệ thống (USD)</label>
          <input
            id="lim-global"
            inputMode="decimal"
            value={global}
            placeholder={envHint(env.global_daily_usd)}
            aria-invalid={g === "invalid"}
            onChange={(e) => setGlobal(e.target.value)}
          />
          <span className="hint small"> Trống = theo env. Ngân sách tháng chỉ đặt bằng env.</span>
        </div>
        <div>
          <label>
            <input
              type="checkbox"
              checked={signupOn}
              disabled={!signupOn && !mayEnable}
              onChange={(e) => setSignup(e.target.checked)}
            />{" "}
            Cho phép đăng ký
          </label>
          <span className="hint small">
            {" "}
            {mayEnable || signupOn
              ? "Ai cũng đăng ký được ở /login (chưa xác thực email). Email admin luôn bị chặn."
              : "Cần đủ cả 2 hạn mức mới bật được."}
          </span>
          {blocked && !invalid && (
            <p className="error small" role="alert">
              Chưa lưu được: đăng ký chỉ bật khi có đủ cả hạn mức mỗi người và ngân sách ngày. Điền ô còn trống hoặc tắt
              đăng ký.
            </p>
          )}
        </div>
      </fieldset>

      <p className="muted small">
        Đăng ký công khai hiện: <strong>{effective.signup_open ? "đang mở" : "đang đóng"}</strong>
        {effective.signup_enabled && !effective.signup_open && " (đã bật nhưng thiếu hạn mức nên vẫn đóng)"}.
      </p>
      <p className="muted small">
        Hôm nay: toàn hệ thống {fmtUsd(today.global_spent_usd)} · người dùng chi nhiều nhất{" "}
        {fmtUsd(today.max_user_spent_usd)} · đang áp dụng:{" "}
        {effective.user_daily_usd === null ? "không giới hạn" : fmtUsd(effective.user_daily_usd)}
        {" / người, "}
        {effective.global_daily_usd === null ? "không giới hạn" : fmtUsd(effective.global_daily_usd)} / ngày.
      </p>

      {pending ? (
        <div className="prov-form" role="alertdialog" aria-label="Xác nhận hạ hạn mức">
          {pending.warnings.map((w) => (
            <p key={w} className="error">
              {w}
            </p>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn-danger-solid"
              disabled={save.isPending}
              onClick={() => save.mutate({ ...pending.body, confirm: true })}
            >
              Vẫn lưu
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setPending(null);
                save.reset();
              }}
            >
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="submit" className="btn-primary" disabled={!dirty || invalid || blocked || save.isPending}>
            {save.isPending ? "Đang lưu…" : "Lưu"}
          </button>
          {save.isSuccess && !dirty && (
            <span role="status" className="muted small">
              Đã lưu.
            </span>
          )}
        </div>
      )}
      {invalid && (
        <p className="error" role="alert">
          Nhập số USD ≥ 0 (hoặc để trống).
        </p>
      )}
      {save.error && !pending && (
        <p className="error" role="alert">
          {message(save.error)}
        </p>
      )}
    </form>
  );
}

export function LimitsSection() {
  const q = useAdminSettings();
  if (q.error) return <p className="error">{errorMessage(q.error)}</p>;
  if (!q.data) return <p className="muted">Đang tải…</p>;
  return (
    <div className="section-plain">
      <h2>Hạn mức & đăng ký</h2>
      <p className="muted small">Có hiệu lực ngay ở lần kiểm tra kế tiếp, không cần khởi động lại.</p>
      <LimitsForm data={q.data} />
    </div>
  );
}
