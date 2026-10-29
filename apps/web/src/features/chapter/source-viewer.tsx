/**
 * Canvas khi chương chưa có page: 1 ảnh gốc, vừa bề ngang khung (không phóng quá cỡ thật), ảnh cao cuộn dọc như đọc
 * webtoon. File chưa tải lên (URL ký 404) → ô "Chưa tải", thử lại mỗi khi upload xong thêm file.
 */
import { useEffect, useState } from "react";
import { useChapterUpload } from "../upload/upload-manager.ts";
import { SKIP_LABEL, type SourceItem } from "./source-rail-model.ts";

export function SourceViewer(props: {
  chapterId: string;
  item: SourceItem | undefined;
  index: number;
  total: number;
  onStep(dir: -1 | 1): void;
}) {
  const { item, index, total } = props;
  const retryKey = useChapterUpload(props.chapterId)?.done ?? 0;
  const [missing, setMissing] = useState(false);
  // Đổi ảnh / upload xong thêm file → thử tải lại.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey chỉ dùng để kích hoạt thử lại
  useEffect(() => setMissing(false), [item?.url, retryKey]);

  return (
    <div className="cw-canvas">
      {/* key: đổi ảnh → khung cuộn mới, về đầu ảnh (ảnh webtoon cao). */}
      <div className="cw-source-view" key={item?.id}>
        {!item ? (
          <p className="muted">Chưa có ảnh.</p>
        ) : missing ? (
          <div className="source-missing small muted">Chưa tải</div>
        ) : (
          <figure data-skipped={item.skip ? "" : undefined}>
            <img src={item.url} alt={`Ảnh gốc ${item.n}`} onError={() => setMissing(true)} />
            {item.skip && (
              <figcaption className="small">{SKIP_LABEL[item.skip]} — bỏ qua ảnh này khi cắt trang</figcaption>
            )}
          </figure>
        )}
      </div>
      <div className="cw-canvas-foot">
        <span className="cw-pager">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => props.onStep(-1)}
            aria-label="Ảnh trước"
            title="Ảnh trước (←)"
          >
            ‹
          </button>
          <span>
            Ảnh {index >= 0 ? index + 1 : "–"}/{total || "–"}
          </span>
          <button
            type="button"
            disabled={index < 0 || index >= total - 1}
            onClick={() => props.onStep(1)}
            aria-label="Ảnh sau"
            title="Ảnh sau (→)"
          >
            ›
          </button>
        </span>
      </div>
    </div>
  );
}
