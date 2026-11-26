/**
 * Cài đặt dịch — bảng xưng hô: mỗi hàng người nói → người nghe: xưng / gọi (+ ghi chú). Hàng AI ghi có chip "AI"; sửa
 * hàng thì chip mất ngay (server tính lại `origin` khi lưu). Rời một hàng → `onRowLeave` (cha lưu các hàng đủ ô); rời
 * cả bảng → `onLeave`. `invalid` tô đỏ ô bắt buộc còn trống của hàng thiếu (hàng đó chưa được lưu).
 */
import type { FocusEvent } from "react";
import { AiTag } from "../../app/ai-tag.tsx";
import { useT } from "../../i18n/t.ts";
import type { PronounRuleInput } from "./api.ts";
import { addressPlaceholder, type TargetLang } from "./lang-labels.ts";
import type { FormRule, RuleField } from "./settings-draft.ts";

const left = (e: FocusEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null);

export function PronounRulesTable(props: {
  rules: FormRule[];
  targetLang: TargetLang;
  invalid: boolean;
  onEdit(i: number, patch: Partial<PronounRuleInput>): void;
  onRemove(i: number): void;
  onAdd(): void;
  onRowLeave(): void;
  onLeave(): void;
}) {
  const { t } = useT();
  const { rules } = props;
  const bad = (r: FormRule, field: RuleField) => (props.invalid && !r[field].trim() ? true : undefined);
  const cell = (i: number, r: FormRule, field: keyof PronounRuleInput, label: string, placeholder?: string) => (
    <td>
      <input
        aria-label={label}
        aria-invalid={field === "note" ? undefined : bad(r, field)}
        placeholder={placeholder}
        value={r[field]}
        onChange={(e) => props.onEdit(i, { [field]: e.target.value })}
      />
    </td>
  );
  const speaker = t("series.pronounRulesTable.speaker");
  const listener = t("series.pronounRulesTable.listener");
  const address = t("series.pronounRulesTable.address");
  const note = t("series.pronounRulesTable.note");
  return (
    <fieldset
      className="pronoun-rules"
      aria-label={t("series.pronounRulesTable.label")}
      data-field="pronoun_rules"
      onBlur={(e) => left(e) && props.onLeave()}
    >
      {rules.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>{speaker}</th>
              <th>{listener}</th>
              <th>{address}</th>
              <th>{note}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: hàng chưa có id; thứ tự chỉ đổi khi xoá.
              <tr key={i} onBlur={(e) => left(e) && props.onRowLeave()}>
                {cell(i, r, "speaker", speaker)}
                {cell(i, r, "listener", listener)}
                {cell(i, r, "address", address, addressPlaceholder(props.targetLang))}
                {cell(i, r, "note", note)}
                <td className="rule-actions">
                  {r.origin === "ai" && <AiTag />}
                  <button type="button" className="btn-ghost btn-danger" onClick={() => props.onRemove(i)}>
                    {t("common.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.invalid && (
        <span className="small error" role="alert">
          {t("series.pronounRulesTable.invalid")}
        </span>
      )}
      <div className="add-rule">
        <button type="button" onClick={props.onAdd}>
          {t("series.pronounRulesTable.add")}
        </button>
      </div>
    </fieldset>
  );
}
