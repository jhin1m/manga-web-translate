/**
 * Khung ảnh 3:4 của thẻ series / chương. `src` null hoặc ảnh lỗi (404 khi file chưa lên storage) → ô màu theo theme +
 * chữ cái đầu / `fallback`. Đổi `src` (vd. `?s=` đổi theo trạng thái chương) → thử tải lại. `children`: lớp phủ (vạch
 * tiến độ…).
 */
import { type ReactNode, useState } from "react";

export function CoverImage(props: { src: string | null | undefined; fallback: string; children?: ReactNode }) {
  const { src, fallback } = props;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Lỗi nhớ theo src: đổi src thì `failedSrc !== src` → thử tải lại. Tải được thì quên lỗi cũ: chương nháp 404 ở src
  // gốc → `?s=ingesting` có ảnh → về lại src gốc vẫn phải thử tải, không kẹt placeholder.
  const showImg = !!src && failedSrc !== src;
  return (
    <div className="cover" data-empty={showImg ? undefined : ""}>
      {showImg ? (
        <img
          src={src}
          alt=""
          width={300}
          height={400}
          loading="lazy"
          decoding="async"
          onLoad={() => setFailedSrc(null)}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="cover-fallback" aria-hidden="true">
          {fallback}
        </span>
      )}
      {props.children}
    </div>
  );
}

/** Chữ cái đầu (có dấu giữ nguyên) của tên series cho ô placeholder. */
export const initialOf = (title: string) => Array.from(title.trim())[0]?.toUpperCase() ?? "?";

/** Thêm `s=` vào URL ảnh: đổi theo trạng thái chương để ảnh tải lại đúng lúc, không đổi giữa các lượt polling. */
export const withStatus = (src: string, status: string) => `${src}${src.includes("?") ? "&" : "?"}s=${status}`;
