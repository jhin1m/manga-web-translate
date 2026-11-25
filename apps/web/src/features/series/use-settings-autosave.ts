/**
 * Tự lưu của modal Cài đặt dịch: mỗi lượt PATCH chỉ gửi một trường vừa đổi (kèm khoá các cặp xưng hô form đã thấy),
 * các lượt chạy nối tiếp. Ô chọn và nút Xoá hàng xưng hô lưu ngay (`"now"`). Ô chữ (Tên, Giọng văn, Chữ bỏ qua) chỉ
 * lưu khi rời ô (`leave`) — không lưu giữa lúc gõ, vì "Chữ bỏ qua" có tác dụng ngay lên lô dịch đang chạy; hàng xưng hô
 * lưu khi rời hàng (`commit`). Cả hai dùng `"later"` khi gõ. Trường chưa hợp lệ (tên trống, "Chữ bỏ qua" sai) không
 * lưu; xưng hô chỉ lưu các hàng đủ ô, hàng thiếu ở lại trên form và được tô đỏ (`rulesChecked`). Bản series mới từ
 * server (poll, lưu xong) cập nhật trường người dùng không đang sửa / không có con trỏ / không đang lưu. Modal đóng
 * (unmount) → lưu ngay các trường còn khác mốc (hàng xưng hô thiếu ô bị bỏ). Lưu lỗi → báo lỗi, giữ giá trị đang gõ.
 */
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { patchSeries, type Series, type SeriesPatch, seriesKeys } from "./api.ts";
import { buildPatch, SETTINGS_FIELDS, type SettingsField, type SettingsValues, sameField } from "./settings-diff.ts";
import {
  adoptServer,
  type Draft,
  type DraftState,
  draftValues,
  fieldInvalid,
  isDirty,
  ruleComplete,
  toDraft,
} from "./settings-draft.ts";

export type SaveWhen = "now" | "later";
type SaveVars = { field: SettingsField; seq: number; sent: Draft; body: SeriesPatch };

/** Trường hiện ngoài màn series (danh sách series, tên series ở Hoạt động). */
const LIST_FIELDS = new Set<SettingsField>(["title", "source_lang", "target_lang"]);

/** Trường đang có con trỏ (ô gắn `data-field`). */
const focusedField = () => document.activeElement?.closest<HTMLElement>("[data-field]")?.dataset.field;

export function useSettingsAutosave(series: Series) {
  const qc = useQueryClient();
  const seriesId = series.id;
  // Nháp + mốc nằm ở ref (đọc ngay sau khi sửa, kể cả trong callback lưu xong); state chỉ để render lại.
  const stRef = useRef<DraftState | null>(null);
  if (!stRef.current) {
    const d = toDraft(series);
    stRef.current = { draft: d, base: d };
  }
  const [st, setSt] = useState(stRef.current);
  const update = useCallback((fn: (cur: DraftState) => DraftState) => {
    const cur = stRef.current as DraftState;
    const next = fn(cur);
    if (next === cur) return;
    stRef.current = next;
    setSt(next);
  }, []);
  const seriesRef = useRef(series);
  seriesRef.current = series;

  // Lượt lưu mới nhất của từng trường (số thứ tự + giá trị đã gửi) còn đang chạy / chờ.
  const inflight = useRef(new Map<SettingsField, { seq: number; values: SettingsValues }>());
  const seq = useRef(0);
  // Trường lưu lỗi gần nhất còn chưa lưu lại được: lỗi chỉ tắt khi không còn trường nào như vậy.
  const failed = useRef(new Set<SettingsField>());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rulesChecked, setRulesChecked] = useState(false);

  /**
   * Lấy bản server cho trường không bị giữ (đang lưu / đang có con trỏ). `ignoreFocus` khi vừa rời ô: lúc blur con trỏ
   * chưa sang ô mới.
   */
  const adopt = useCallback(
    (server: Series, only?: SettingsField[], ignoreFocus = false) => {
      const focus = ignoreFocus ? undefined : focusedField();
      const hold = (k: SettingsField) => inflight.current.has(k) || focus === k;
      update((cur) => adoptServer(cur, toDraft(server), hold, only));
    },
    [update],
  );

  const commitRef = useRef<(k: SettingsField) => void>(() => {});
  const save = useMutation({
    mutationKey: ["series-settings", seriesId],
    // Cùng scope → chạy nối tiếp: lượt sau không bị lượt trước ghi đè, mốc xưng hô luôn mới nhất.
    scope: { id: `series-settings:${seriesId}` },
    mutationFn: ({ body }: SaveVars) => patchSeries(seriesId, body),
    onSuccess: (s, { field, seq: n, sent }) => {
      // Ghi ngay bản server trả về: mở lại modal trước khi refetch xong vẫn thấy giá trị mới.
      qc.setQueryData<Series>(seriesKeys.detail(seriesId), (cur) => (cur ? { ...cur, ...s } : cur));
      // Chỉ tên / cặp ngôn ngữ hiện ở danh sách series, Hoạt động… (bìa lưu ở API riêng) → mới tải lại mọi khoá series;
      // trường khác chỉ tải lại chi tiết series này.
      if (LIST_FIELDS.has(field)) void qc.invalidateQueries({ queryKey: seriesKeys.list() });
      else void qc.invalidateQueries({ queryKey: seriesKeys.detail(seriesId), exact: true });
      // Mốc = giá trị vừa lưu theo góc nhìn của nháp (xưng hô: đúng các cặp form đã thấy).
      update((cur) => ({ ...cur, base: { ...cur.base, [field]: sent[field] } }));
      if (inflight.current.get(field)?.seq !== n) return;
      inflight.current.delete(field);
      failed.current.delete(field);
      if (failed.current.size === 0) {
        setError(null);
        setSaved(true);
      }
      // Người dùng sửa tiếp trong lúc lưu: đã rời ô → lưu tiếp; còn con trỏ ở ô thì chờ rời ô. Không sửa → lấy bản server.
      if (isDirty(stRef.current as DraftState, field)) {
        if (focusedField() !== field) commitRef.current(field);
      } else {
        adopt({ ...seriesRef.current, ...s }, [field]);
      }
    },
    onError: (e, { field, seq: n }) => {
      if (inflight.current.get(field)?.seq === n) inflight.current.delete(field);
      failed.current.add(field);
      setSaved(false);
      setError(errorMessage(e));
    },
  });
  const { mutate } = save;

  const commit = useCallback(
    (k: SettingsField) => {
      const cur = stRef.current as DraftState;
      // Hàng xưng hô thiếu ô: tô đỏ, các hàng đủ vẫn lưu.
      if (k === "pronoun_rules") setRulesChecked(!cur.draft.pronoun_rules.every(ruleComplete));
      if (fieldInvalid(cur.draft, k)) return;
      const values = draftValues(cur.draft);
      const running = inflight.current.get(k);
      if (running && sameField(running.values, values, k)) return;
      const body = buildPatch(draftValues(cur.base), values, [k]);
      if (!body) {
        // Trường lỗi đã được trả về đúng giá trị server → không còn gì chờ lưu.
        if (!running && failed.current.delete(k) && failed.current.size === 0) setError(null);
        return;
      }
      seq.current += 1;
      inflight.current.set(k, { seq: seq.current, values });
      mutate({ field: k, seq: seq.current, sent: cur.draft, body });
    },
    [mutate],
  );
  commitRef.current = commit;

  /** Sửa trường `k`; `"now"` lưu ngay, `"later"` chờ `commit` / `leave` (hoặc đóng modal). */
  const set = useCallback(
    <K extends SettingsField>(k: K, v: Draft[K], when: SaveWhen) => {
      update((cur) => ({ ...cur, draft: { ...cur.draft, [k]: v } }));
      if (when === "now") commit(k);
    },
    [commit, update],
  );

  /** Rời ô chữ: lưu ngay; nếu không còn gì để lưu thì hiện bản server (VD danh sách đã gộp mục trùng). */
  const leave = useCallback(
    (k: SettingsField) => {
      commit(k);
      adopt(seriesRef.current, [k], true);
    },
    [commit, adopt],
  );

  // Bản series mới (poll, lưu xong, tab khác) → cập nhật trường không đang sửa.
  useEffect(() => adopt(series), [series, adopt]);

  // Đóng modal (kể cả chuyển sang `?tab=glossary`) → lưu ngay các trường còn khác mốc.
  useEffect(
    () => () => {
      for (const k of SETTINGS_FIELDS) commitRef.current(k);
    },
    [],
  );

  const pending = useIsMutating({ mutationKey: ["series-settings", seriesId] }) > 0;
  return {
    draft: st.draft,
    set,
    commit,
    leave,
    adopt,
    rulesChecked,
    setRulesChecked,
    status: { pending, error, saved },
  };
}
