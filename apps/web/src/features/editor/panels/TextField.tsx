/**
 * Ô nhập chữ dùng chung của panel: giữ bản nháp cục bộ, đẩy lên store mỗi lần gõ — trừ lúc bộ gõ đang
 * compose (Telex/VNI/IME), khi đó đợi compositionend để store (chuẩn hoá NFC) không cắt ngang dấu đang gõ.
 */
import { type TextareaHTMLAttributes, useEffect, useRef, useState } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue(v: string): void;
};

export function TextField({ value, onValue, onFocus, onBlur, readOnly, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  // Hết chỉ đọc (VD page vừa kích hoạt xong, có thể với bản server mới hơn) → lấy giá trị mới dù đang focus:
  // lúc chỉ đọc người dùng chưa gõ được gì, nên không mất bản nháp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ đồng bộ khi readOnly đổi.
  useEffect(() => {
    if (!readOnly) setDraft(value);
  }, [readOnly]);
  return (
    <textarea
      {...rest}
      readOnly={readOnly}
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setDraft(value);
        onBlur?.(e);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        onValue(e.currentTarget.value);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!composing.current) onValue(e.target.value);
      }}
    />
  );
}
