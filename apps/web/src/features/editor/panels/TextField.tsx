/**
 * Ô nhập chữ dùng chung của panel: giữ bản nháp cục bộ, đẩy lên store mỗi lần gõ — trừ lúc bộ gõ đang
 * compose (Telex/VNI/IME), khi đó đợi compositionend để store (chuẩn hoá NFC) không cắt ngang dấu đang gõ.
 */
import { type TextareaHTMLAttributes, useEffect, useRef, useState } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue(v: string): void;
};

export function TextField({ value, onValue, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      {...rest}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(value);
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
