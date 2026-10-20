/**
 * Cài đặt series: ngôn ngữ, kính ngữ, quy tắc xưng hô theo cặp nhân vật, style prompt, font mặc định, tier
 * model + glossary của series. Server tăng settings_rev khi trường ảnh hưởng dịch đổi.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { GlossaryEditor } from "../glossary/glossary-editor.tsx";
import {
  FONT_IDS,
  type FontSlot,
  fetchSeries,
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

export function SeriesSettingsPage({ ws, seriesId }: { ws: string; seriesId: string }) {
  const q = useQuery({ queryKey: seriesKeys.detail(ws, seriesId), queryFn: () => fetchSeries(ws, seriesId) });
  return (
    <div className="page page-narrow">
      <div className="crumbs">
        <Link to="/">Series</Link> /{" "}
        <Link to="/w/$ws/s/$seriesId" params={{ ws, seriesId }}>
          {q.data?.title ?? "…"}
        </Link>
      </div>
      <div className="page-head">
        <h1>Cài đặt series</h1>
        {q.data && (
          <span className="muted small mono">
            settings_rev {q.data.settings_rev} · glossary_rev {q.data.glossary_rev}
          </span>
        )}
      </div>
      {q.error && <p className="notice danger">{errorMessage(q.error)}</p>}
      {/* key: dựng lại form khi dữ liệu server đổi rev (sau khi lưu). */}
      {q.data && <SettingsForm key={`${q.data.id}:${q.data.settings_rev}`} ws={ws} series={q.data} />}
      <div className="section">
        <h2 style={{ marginBottom: 8 }}>Glossary của series</h2>
        <GlossaryEditor ws={ws} seriesId={seriesId} />
      </div>
    </div>
  );
}

function SettingsForm({ ws, series }: { ws: string; series: Series }) {
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
    <form onSubmit={submit}>
      <label htmlFor="s-title">Tên series</label>
      <input id="s-title" required value={f.title} onChange={(e) => set("title", e.target.value)} />

      <div className="grid-2">
        <div>
          <label htmlFor="s-src">Ngôn ngữ gốc</label>
          <select
            id="s-src"
            value={f.source_lang}
            onChange={(e) => set("source_lang", e.target.value as Form["source_lang"])}
          >
            <option value="ko">Tiếng Hàn (ko)</option>
            <option value="ja" disabled>
              Tiếng Nhật (sau MVP)
            </option>
            <option value="zh" disabled>
              Tiếng Trung (sau MVP)
            </option>
            <option value="en" disabled>
              Tiếng Anh (sau MVP)
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
          <select id="s-tier" value={f.llm_tier} onChange={(e) => set("llm_tier", e.target.value as Form["llm_tier"])}>
            <option value="standard">Standard (rẻ, nhanh)</option>
            <option value="premium">Premium (chất lượng cao hơn)</option>
          </select>
        </div>
      </div>

      <label htmlFor="s-style">Style prompt (ngắn)</label>
      <textarea
        id="s-style"
        maxLength={1000}
        placeholder="VD: giọng trẻ, đời thường; giữ tên riêng phiên âm Hàn"
        value={f.style_prompt}
        onChange={(e) => set("style_prompt", e.target.value)}
      />

      <span className="label">Font mặc định</span>
      <div className="grid-2">
        {FONT_SLOTS.map(({ slot, label }) => (
          <div key={slot}>
            <label htmlFor={`s-font-${slot}`} style={{ marginTop: 0 }}>
              {label}
            </label>
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

      <span className="label">Quy tắc xưng hô (người nói → người nghe: cách xưng/gọi)</span>
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
      <p>
        <button
          type="button"
          onClick={() =>
            set("pronoun_rules", [...f.pronoun_rules, { speaker: "", listener: "", address: "", note: "" }])
          }
        >
          Thêm quy tắc
        </button>
      </p>

      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" className="btn-primary" disabled={save.isPending || !rulesValid || !f.title.trim()}>
          Lưu cài đặt
        </button>
        {!rulesValid && <span className="small error">Điền đủ người nói, người nghe, xưng/gọi cho mọi quy tắc.</span>}
        {saved && <span className="small muted">{saved}</span>}
        {save.error && <span className="small error">{errorMessage(save.error)}</span>}
      </div>
    </form>
  );
}
