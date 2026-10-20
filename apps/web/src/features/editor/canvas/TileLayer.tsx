/**
 * Ảnh page vẽ theo tile 2048px (toạ độ page): ảnh tải 1 lần thành ImageBitmap, mỗi tile cắt bằng
 * `createImageBitmap(src, sx, sy, sw, sh)` khi vào vùng nhìn ± 1 tile, ra khỏi vùng thì `close()`.
 * Không canvas/bitmap tile nào vượt 2048px/cạnh; Stage chỉ to bằng khung nhìn (giới hạn canvas Safari/iOS).
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Group, Image as KImage } from "react-konva";

export const TILE = 2048;

function closeAll(map: Map<string, ImageBitmap | "pending">) {
  for (const v of map.values()) if (v !== "pending") v.close();
  map.clear();
}

type Tile = { key: string; x: number; y: number; w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };

/** Tile phủ vùng nhìn, nới thêm 1 tile mỗi phía. */
export function visibleTiles(page: { w: number; h: number }, viewport: Rect): Tile[] {
  const out: Tile[] = [];
  const c0 = Math.max(0, Math.floor(viewport.x / TILE) - 1);
  const c1 = Math.min(Math.ceil(page.w / TILE) - 1, Math.floor((viewport.x + viewport.w) / TILE) + 1);
  const r0 = Math.max(0, Math.floor(viewport.y / TILE) - 1);
  const r1 = Math.min(Math.ceil(page.h / TILE) - 1, Math.floor((viewport.y + viewport.h) / TILE) + 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = c * TILE;
      const y = r * TILE;
      out.push({ key: `${r}:${c}`, x, y, w: Math.min(TILE, page.w - x), h: Math.min(TILE, page.h - y) });
    }
  }
  return out;
}

/** Tải ảnh (URL ký) thành bitmap; đổi URL theo rev ảnh, không theo lần ký lại. */
function useBitmap(url: string | null, revKey: string) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: URL ký lại mỗi lần GET — chỉ tải lại khi rev đổi.
  useEffect(() => {
    if (!url) return;
    let live = true;
    let bmp: ImageBitmap | null = null;
    setError(null);
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tải ảnh lỗi (${res.status})`);
      bmp = await createImageBitmap(await res.blob());
      if (live) setBitmap(bmp);
      else bmp.close();
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      setBitmap(null);
      bmp?.close();
    };
  }, [revKey]);
  return { bitmap, error };
}

export function TileLayer(props: {
  url: string | null;
  revKey: string;
  page: { w: number; h: number };
  viewport: Rect;
  /** false: giữ tile đã cắt nhưng không vẽ (layer ảnh gốc giữ lại sau lần so sánh đầu, không tải lại). */
  visible?: boolean;
  onError?: (msg: string | null) => void;
}) {
  const { bitmap, error } = useBitmap(props.url, props.revKey);
  const { onError } = props;
  useEffect(() => onError?.(error), [error, onError]);
  const tiles = visibleTiles(props.page, props.viewport);
  const wanted = tiles.map((t) => t.key).join(",");
  /**
   * key → bitmap tile (hoặc "pending" khi đang cắt), gắn với bitmap nguồn. Đổi nguồn (rev mới) → đổi map NGAY
   * trong lần render đó (node Konva không còn trỏ tile cũ), tile cũ đóng sau khi canvas đã vẽ lại — đóng sớm
   * thì Konva có thể vẽ một ImageBitmap đã close (InvalidStateError).
   */
  const cache = useRef<{ src: ImageBitmap | null; map: Map<string, ImageBitmap | "pending"> }>({
    src: null,
    map: new Map(),
  });
  if (cache.current.src !== bitmap) {
    const old = cache.current.map;
    cache.current = { src: bitmap, map: new Map() };
    setTimeout(() => closeAll(old), 1000);
  }
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Ảnh có thể khác kích thước page (VD ảnh giả 1×1 trong test) → cắt theo tỉ lệ.
  const scale = useMemo(
    () => (bitmap ? { x: bitmap.width / props.page.w, y: bitmap.height / props.page.h } : null),
    [bitmap, props.page.w, props.page.h],
  );

  useEffect(() => () => closeAll(cache.current.map), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `wanted` là chữ ký của tập tile hiển thị.
  useEffect(() => {
    if (!bitmap || !scale) return;
    const map = cache.current.map;
    const keep = new Set(wanted.split(","));
    for (const [k, v] of map) {
      if (keep.has(k)) continue;
      if (v !== "pending") v.close();
      map.delete(k);
    }
    for (const t of tiles) {
      if (map.has(t.key)) continue;
      map.set(t.key, "pending");
      const resize = scale.x === 1 && scale.y === 1 ? {} : { resizeWidth: t.w, resizeHeight: t.h };
      createImageBitmap(
        bitmap,
        t.x * scale.x,
        t.y * scale.y,
        Math.max(1, t.w * scale.x),
        Math.max(1, t.h * scale.y),
        resize,
      )
        .then((b) => {
          if (map !== cache.current.map || map.get(t.key) !== "pending") return b.close();
          map.set(t.key, b);
          bump();
        })
        .catch(() => map.delete(t.key));
    }
  }, [bitmap, scale, wanted]);

  return (
    <Group visible={props.visible ?? true}>
      {tiles.map((t) => {
        const img = cache.current.map.get(t.key);
        return img && img !== "pending" ? (
          <KImage key={t.key} image={img} x={t.x} y={t.y} width={t.w} height={t.h} />
        ) : null;
      })}
    </Group>
  );
}
