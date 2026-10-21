/**
 * Form cài đặt dịch của series (chia nhóm Chung / Dịch / Font / Xưng hô): ngôn ngữ, kính ngữ, tier model, giọng văn,
 * font mặc định, quy tắc xưng hô theo cặp nhân vật. Server tăng settings_rev khi trường ảnh hưởng dịch đổi. Kèm vùng
 * xoá series. Dùng ở `?tab=settings` của màn series.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import {
  deleteSeries,
  FONT_IDS,
  type FontSlot,
  type PronounRule,
  patchSeries,
  type Series,
  type SeriesSettings,
  seriesKeys,
} from "./api.ts";

const FONT_SLOTS: { slot: FontSlot; label: string }[] = [
  { slot: "dialogue", label: "Thoại" },
  { slot: "narration", label: "Dẫn truyện" },
  { slot: "sfx", label: "SFX" },
];

type Form = SeriesSettings & { title: string };

const toForm = (s: Series): Form => ({
  title: s.title,
  source_lang: s.source_lang,
  target_lang: s.target_lang,
  honorific_policy: s.honorific_policy,
  pronoun_rules: s.pronoun_rules,
  style_prompt: s.style_prompt,
  default_fonts: s.default_fonts,
  llm_tier: s.llm_tier,
});

export function SeriesSettingsForm({ ws, series }: { ws: string; series: Series }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => toForm(series));
  const [saved, setSaved] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => patchSeries(ws, series.id, f),
    onSuccess: (s) => {
      setSaved(
        s.settings_rev !== series.settings_rev
          ? "Đã lưu. Lần dịch sau dùng cài đặt mới (chương đã dịch không tự chạy lại)."
          : "Đã lưu.",
      );
      void qc.invalidateQueries({ queryKey: ["series", ws] });
    },
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(null);
    setF((cur) => ({ ...cur, [k]: v }));
  };
  const setRule = (i: number, patch: Partial<PronounRule>) =>
    set(
      "pronoun_rules",
      f.pronoun_rules.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const rulesValid = f.pronoun_rules.every((r) => r.speaker.trim() && r.listener.trim() && r.address.trim());

  return (
    <form onSubmit={submit} className="settings-form">
      <fieldset className="settings-group">
        <legend>Chung</legend>
        <label htmlFor="s-title">Tên series</label>
        <input id="s-title" required value={f.title} onChange={(e) => set("title", e.target.value)} />
      </fieldset>

      <fieldset className="settings-group">
        <legend>Dịch</legend>
        <div className="grid-pairs">
          <div>
            <label htmlFor="s-src">Ngôn ngữ gốc</label>
            <select
              id="s-src"
              value={f.source_lang}
              onChange={(e) => set("source_lang", e.target.value as Form["source_lang"])}
            >
              <option value="ko">Tiếng Hàn (ko)</option>
              <option value="ja" disabled>
                Tiếng Nhật (sắp có)
              </option>
              <option value="zh" disabled>
                Tiếng Trung (sắp có)
              </option>
              <option value="en" disabled>
                Tiếng Anh (sắp có)
              </option>
            </select>
          </div>
          <div>
            <label htmlFor="s-tgt">Ngôn ngữ đích</label>
            <select id="s-tgt" value={f.target_lang} onChange={(e) => set("target_lang", e.target.value as "vi")}>
              <option value="vi">Tiếng Việt (vi)</option>
            </select>
          </div>
          <div>
            <label htmlFor="s-hon">Kính ngữ (-nim, -ssi…)</label>
            <select
              id="s-hon"
              value={f.honorific_policy}
              onChange={(e) => set("honorific_policy", e.target.value as Form["honorific_policy"])}
            >
              <option value="translate">Chuyển sang xưng hô tiếng Việt</option>
              <option value="keep">Giữ nguyên hậu tố</option>
            </select>
          </div>
          <div>
            <label htmlFor="s-tier">Model dịch</label>
            <select
              id="s-tier"
              value={f.llm_tier}
              onChange={(e) => set("llm_tier", e.target.value as Form["llm_tier"])}
            >
              <option value="standard">Standard (rẻ, nhanh)</option>
              <option value="premium">Premium (chất lượng cao hơn)</option>
            </select>
          </div>
        </div>
        <label htmlFor="s-style">Giọng văn</label>
        <textarea
          id="s-style"
          maxLength={1000}
          placeholder="VD: giọng trẻ, đời thường; giữ tên riêng phiên âm Hàn"
          value={f.style_prompt}
          onChange={(e) => set("style_prompt", e.target.value)}
        />
        <span className="hint">Mô tả ngắn gửi kèm cho AI ở mọi lần dịch.</span>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Font mặc định</legend>
        <div className="grid-3">
          {FONT_SLOTS.map(({ slot, label }) => (
            <div key={slot}>
              <label htmlFor={`s-font-${slot}`}>{label}</label>
              <select
                id={`s-font-${slot}`}
                value={f.default_fonts[slot] ?? ""}
                onChange={(e) => {
                  const next = { ...f.default_fonts };
                  if (e.target.value) next[slot] = e.target.value;
                  else delete next[slot];
                  set("default_fonts", next);
                }}
              >
                <option value="">Mặc định hệ thống</option>
                {FONT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Quy tắc xưng hô</legend>
        <span className="hint">Người nói → người nghe: cách xưng / gọi. VD: Minjun → Seoyeon: anh/em.</span>
        {f.pronoun_rules.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>Người nói</th>
                <th>Người nghe</th>
                <th>Xưng / gọi</th>
                <th>Ghi chú</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.pronoun_rules.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: hàng chưa có id; thứ tự chỉ đổi khi xoá.
                <tr key={i}>
                  <td>
                    <input
                      aria-label="Người nói"
                      value={r.speaker}
                      onChange={(e) => setRule(i, { speaker: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Người nghe"
                      value={r.listener}
                      onChange={(e) => setRule(i, { listener: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Xưng / gọi"
                      placeholder="anh/em"
                      value={r.address}
                      onChange={(e) => setRule(i, { address: e.target.value })}
                    />
                  </td>
                  <td>
                    <input aria-label="Ghi chú" value={r.note} onChange={(e) => setRule(i, { note: e.target.value })} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost btn-danger"
                      onClick={() =>
                        set(
                          "pronoun_rules",
                          f.pronoun_rules.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="add-rule">
          <button
            type="button"
            onClick={() =>
              set("pronoun_rules", [...f.pronoun_rules, { speaker: "", listener: "", address: "", note: "" }])
            }
          >
            + Thêm quy tắc
          </button>
        </div>
      </fieldset>

      <div className="settings-save">
        <button type="submit" className="btn-primary" disabled={save.isPending || !rulesValid || !f.title.trim()}>
          {save.isPending ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
        {!rulesValid && <span className="small error">Điền đủ người nói, người nghe, xưng/gọi cho mọi quy tắc.</span>}
        {saved && (
          <span className="small muted" role="status">
            {saved}
          </span>
        )}
        {save.error && <span className="small error">{errorMessage(save.error)}</span>}
      </div>
    </form>
  );
}

/** Xoá series: gõ đúng tên để mở khoá nút (xoá luôn mọi chương + glossary riêng, không hoàn tác). */
export function DeleteSeries({ ws, series }: { ws: string; series: Series & { chapters?: unknown[] } }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => deleteSeries(ws, series.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: seriesKeys.detail(ws, series.id) });
      void qc.invalidateQueries({ queryKey: seriesKeys.list(ws) });
      void navigate({ to: "/" });
    },
  });
  const n = series.chapters?.length ?? 0;
  return (
    <section className="danger-zone" aria-label="Xoá series">
      <h2>Xoá series</h2>
      <p className="small">
        Xoá vĩnh viễn <b>{series.title}</b>
        {n > 0 ? ` cùng ${n} chương (ảnh, bản dịch, lịch sử)` : ""} và glossary riêng của series. Không hoàn tác được.
      </p>
      <label htmlFor="s-delete">Gõ tên series để xác nhận</label>
      <div className="row">
        <input
          id="s-delete"
          value={typed}
          placeholder={series.title}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <button
          type="button"
          className="btn-danger-solid"
          disabled={typed.trim() !== series.title.trim() || del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? "Đang xoá…" : "Xoá series"}
        </button>
      </div>
      {del.error && <span className="small error">{errorMessage(del.error)}</span>}
    </section>
  );
}
