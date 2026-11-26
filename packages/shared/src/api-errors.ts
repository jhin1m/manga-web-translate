/**
 * Hợp đồng lỗi API người dùng thấy: mỗi mã có một câu tiếng Việt (`{name}` = tham số). API trả
 * `{ error, variant?, message, params }`: `error` là mã ổn định cũ (client so sánh theo nó), `variant` có khi cùng
 * `error` mang nhiều câu khác nhau (mã đầy đủ ở đây = `<error>.<variant>`), `message` là câu tiếng Việt cũ giữ nguyên
 * cho client cũ, `params` để web dịch lại theo `errors.<error>[.<variant>]` của ngôn ngữ giao diện.
 *
 * Mã lý do của chữ bỏ qua (`IGNORE_ISSUE_CODES`) cũng nằm ở đây: API đặt câu này vào `issues[].message` của
 * `invalid_body`, web dịch theo cùng mã.
 */
const MESSAGES_VI = {
  // Glossary
  duplicate_term: '"{term}" đã có trong glossary này',
  "duplicate_term.unnamed": "term đã có trong glossary này",
  csv_empty: "CSV không có dòng nào",
  csv_too_many_rows: "tối đa {max} dòng",
  csv_unclosed_quote: "CSV: thiếu dấu nháy kép đóng",
  csv_missing_columns: "header phải có cột source_term, target_term",
  csv_invalid_fields: "{fields}",
  // Chương, ảnh gốc
  chapter_number_taken: "series đã có chương {number}",
  "chapter_not_draft.committed": "chương đã commit — không upload thêm",
  "chapter_not_draft.processed": "chương đã xử lý — tạo chương mới để upload lại",
  no_source_files: "chương chưa có ảnh nào",
  "no_valid_files.all_skipped": "Đã bỏ hết ảnh",
  sources_changed: "bộ ảnh vừa đổi — bấm lại Bước 1",
  no_size: "chưa biết chiều cao ảnh",
  trim_too_large: "phải chừa lại ít nhất {min}px",
  source_set_mismatch: "danh sách ảnh không khớp bộ ảnh của chương",
  "no_pages.translate": "chương chưa có trang để dịch",
  "no_pages.export": "chương chưa có trang để xuất",
  last_page: "không xoá được trang cuối cùng",
  // Dịch, quét lại, xuất, hiệu đính
  translate_running: "chương đang dịch — chờ xong hoặc huỷ",
  "chapter_busy.translate": "chương đang tách trang — chờ xong rồi dịch",
  "chapter_busy.rescan": "chương đang tách trang — chờ xong rồi quét lại",
  "chapter_busy.ingest": "chương còn job đang chạy — huỷ hoặc chờ xong rồi ingest lại",
  "chapter_busy.export": "chương đang xử lý — chờ xong rồi xuất",
  "chapter_busy.batch_edit": "chương đang xử lý — chờ xong rồi sửa hàng loạt",
  "chapter_busy.page_skip": "chương đang xử lý — chờ xong rồi xoá / khôi phục trang",
  chapter_has_user_edits: "chương đã có chỉnh sửa tay — tạo chương mới để ingest lại",
  "page_skipped.translate": "trang đã xoá — khôi phục trước khi dịch",
  "page_skipped.rescan": "trang đã xoá — khôi phục trước khi quét lại",
  "page_not_prepared.count": "{count} page chưa qua giai đoạn 1",
  "page_not_prepared.none_waiting": "không có trang nào chờ dịch",
  "page_not_prepared.rescan": "trang chưa qua giai đoạn 1 — chạy lại trang lỗi",
  chapter_not_prepared: "chương chưa xong bước 1 hoặc đang dịch",
  "page_busy.rescan": "trang đang xoá chữ + OCR — chờ xong",
  page_has_manual_cleanup: "trang đã tẩy / xoá chữ tay trên ảnh — quét lại sẽ mất phần đó",
  chapter_not_translated: "chương chưa dịch xong hoặc đang chạy — dịch xong rồi hiệu đính",
  no_translated_pages: "chương chưa có trang đã dịch",
  export_not_ready: "file chưa xuất xong",
  export_expired: "file đã hết hạn",
  size_mismatch: "state.size khác kích thước page",
  // Xoá chữ lại theo mask
  invalid_mask_source: "page.reinpaint cần user_mask_key + offset, hoặc auto_text_bbox",
  invalid_mask_key: "user_mask_key không thuộc page này",
  // Ảnh tự bỏ / dải cắt đã học của series
  no_whole_image: "Trang không chứa trọn ảnh gốc nào — không học được.",
  "no_hash.image": "Ảnh này không có dấu nhận dạng — không học được.",
  "no_hash.band": "Ảnh này không có kích thước — không học được dải.",
  "plain_image.image": "Ảnh gần như trơn — không học được (dễ tự bỏ nhầm trang truyện).",
  "plain_image.band": "Dải gần như trơn — không học được (dễ tự cắt nhầm trang truyện).",
  skip_images_full: "Series đã có {count} ảnh tự bỏ (tối đa {max}).",
  "not_uploaded.skip_image": "Ảnh chưa tải lên xong — thử lại sau.",
  no_trim: "Mép này của ảnh chưa được cắt — không học được dải.",
  trim_changed: "Số px cắt của mép này đã đổi — cắt lại rồi học lại.",
  band_too_small: "Dải cắt dưới {min} px — quá mỏng để nhận lại.",
  // Ảnh thu nhỏ, ảnh bìa
  "not_uploaded.thumb": "ảnh chưa có",
  invalid_image: "không đọc được ảnh",
  "invalid_image.no_size": "không đọc được kích thước ảnh",
  image_too_large: "ảnh quá lớn",
  unsupported_format: "chỉ nhận PNG, JPEG, WebP",
  "too_large.cover": "ảnh bìa tối đa {max_mb} MB",
  bad_multipart: "cần multipart/form-data",
  missing_file: "thiếu trường file",
  no_cover: "series chưa có ảnh bìa",
  unknown_font: "font không có: {fonts}",
  // Font
  "invalid_key.user_font": "key không thuộc dữ liệu của bạn",
  "invalid_key.system_font": "key không phải file upload font hệ thống",
  "limit.user_fonts": "mỗi tài khoản tối đa {max} font",
  "limit.system_fonts": "font hệ thống tối đa {max} font hoặc {max_mb}MB",
  "in_use.font": "font đang là mặc định của series",
  "not_uploaded.font": "chưa thấy file font đã upload",
  "too_large.font": "font tối đa {max_mb}MB",
  not_font: "chỉ nhận font TTF hoặc OTF (không nhận WOFF/WOFF2/TTC)",
  corrupt_font: "không đọc được font (file hỏng)",
  // Chữ bỏ qua của series (mã = IGNORE_ISSUE_CODES)
  text_length: "mỗi mục {min}–{max} ký tự (không tính http:// và dấu cách)",
  regex_too_long: "regex dài tối đa {max} ký tự (cả hai dấu /)",
  regex_too_short: "regex tối thiểu {min} ký tự giữa hai dấu /",
  regex_nested_quantifier: "regex có lượng từ lồng nhau (kiểu (a+)+) dễ làm treo, hãy viết lại",
  regex_unsupported_syntax: "regex không hỗ trợ tham chiếu ngược (\\1, \\k<tên>) hay lookahead/lookbehind",
  regex_too_many_quantifiers: "regex tối đa {max} lượng từ *, +, {n,}",
  regex_invalid: "regex không hợp lệ",
  regex_matches_empty: "regex khớp cả chuỗi rỗng, sẽ ẩn mọi chữ",
} as const;

export type ApiErrorCode = keyof typeof MESSAGES_VI;

/** Câu tiếng Việt theo mã (chưa thay tham số). Web giữ cùng câu ở `errors.<mã>` của `vi.json` (test kiểm). */
export const API_ERROR_MESSAGES_VI: Readonly<Record<ApiErrorCode, string>> = MESSAGES_VI;

/** Mọi mã lỗi API có câu cho người dùng. `Object.keys` của hằng `as const` ở trên nên đúng tập `ApiErrorCode`. */
export const API_ERROR_CODES = Object.keys(MESSAGES_VI) as readonly ApiErrorCode[];

export const isApiErrorCode = (v: unknown): v is ApiErrorCode => typeof v === "string" && Object.hasOwn(MESSAGES_VI, v);

/** Tên tham số trong câu: `{name}`; `{n,}` (cú pháp regex trong câu) không phải tham số. */
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? (P extends `${string}${"," | " "}${string}` ? never : P) | Placeholders<Rest>
  : never;

/** Tham số bắt buộc của từng mã (mã không có `{…}` → object rỗng). */
export type ApiErrorParams<C extends ApiErrorCode> = {
  readonly [K in Placeholders<(typeof MESSAGES_VI)[C]>]: string | number;
};

/** Đối số tham số: mã không có tham số thì được bỏ trống. */
export type ApiErrorParamsArg<C extends ApiErrorCode> = [Placeholders<(typeof MESSAGES_VI)[C]>] extends [never]
  ? [params?: ApiErrorParams<C>]
  : [params: ApiErrorParams<C>];

export type ApiErrorBody = {
  error: string;
  variant?: string;
  message: string;
  params: Readonly<Record<string, string | number>>;
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** Câu tiếng Việt của mã, thay `{name}` bằng `params.name` (thiếu tham số → giữ nguyên `{name}`). */
export function apiErrorMessageVi(code: ApiErrorCode, params: Readonly<Record<string, string | number>> = {}): string {
  return MESSAGES_VI[code].replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** Tách mã đầy đủ thành `error` (mã ổn định client so sánh) + `variant` (câu cụ thể, nếu có). */
export function splitApiErrorCode(code: ApiErrorCode): { error: string; variant?: string } {
  const dot = code.indexOf(".");
  return dot < 0 ? { error: code } : { error: code.slice(0, dot), variant: code.slice(dot + 1) };
}

/**
 * Body JSON của một lỗi API: `{ error, variant?, message, params }`. Kiểu tham số theo mã được ép ở chỗ gọi
 * (`apiError` của API dùng `ApiErrorParamsArg`).
 */
export function apiErrorBody(code: ApiErrorCode, params: Readonly<Record<string, string | number>> = {}): ApiErrorBody {
  return { ...splitApiErrorCode(code), message: apiErrorMessageVi(code, params), params };
}
