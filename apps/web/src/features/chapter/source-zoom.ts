/**
 * Zoom ảnh gốc ở màn chương nháp (thuần). `scale` = cỡ hiển thị / cỡ thật (1 = 100%); "vừa khung" = vừa bề ngang
 * khung xem, không phóng quá cỡ thật. Ctrl/⌘+cuộn và chụm (wheel kèm ctrlKey) dùng cùng hệ số mũ với editor.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const WHEEL_RATE = 0.0015;
const STEP = 1.25;

export const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/** Scale vừa bề ngang `avail` px (chưa đo được khung → 1). */
export const fitScale = (naturalWidth: number, avail: number) =>
  naturalWidth > 0 && avail > 0 ? Math.min(1, avail / naturalWidth) : 1;

/** Scale mới sau một sự kiện wheel (deltaY dương = thu nhỏ). */
export const wheelZoom = (scale: number, deltaY: number) => clampZoom(scale * Math.exp(-deltaY * WHEEL_RATE));

/** Scale mới sau một lần bấm +/− . */
export const stepZoom = (scale: number, dir: -1 | 1) => clampZoom(dir > 0 ? scale * STEP : scale / STEP);

/**
 * Cuộn thêm bao nhiêu px (theo một trục) để điểm ảnh `nat` (px ảnh thật) đang nằm dưới con trỏ `client` vẫn ở đó sau
 * khi đổi cỡ: `edge` = mép ảnh trên màn hình (clientLeft / clientTop) đã đo ở cỡ `scale` mới.
 */
export const anchorShift = (edge: number, nat: number, scale: number, client: number) => edge + nat * scale - client;
