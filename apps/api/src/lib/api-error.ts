/**
 * Lỗi API người dùng thấy: `{ error, variant?, message, params }` theo hợp đồng `@mtl/shared` (`api-errors.ts`) — web
 * dịch theo mã + tham số, `message` tiếng Việt giữ cho client cũ. `extra` = trường dữ liệu thêm (VD `rejected`,
 * `series`), không phải tham số của câu.
 */
import { type ApiErrorCode, type ApiErrorParamsArg, apiErrorBody } from "@mtl/shared";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type Extra = Readonly<Record<string, unknown>>;
type Params = Readonly<Record<string, string | number>>;
/** Tham số của câu (bắt buộc khi câu có `{…}`) rồi trường dữ liệu thêm. */
type Args<C extends ApiErrorCode> = [...ApiErrorParamsArg<C>, extra?: Extra];

const respond = (status: ContentfulStatusCode, code: ApiErrorCode, params?: Params, extra?: Extra) =>
  Response.json({ ...extra, ...apiErrorBody(code, params) }, { status });

/** Response lỗi có mã (dùng nơi cần trả Response, VD `onError` của middleware). */
export function apiErrorResponse<C extends ApiErrorCode>(
  status: ContentfulStatusCode,
  code: C,
  ...args: Args<C>
): Response;
export function apiErrorResponse(status: ContentfulStatusCode, code: ApiErrorCode, params?: Params, extra?: Extra) {
  return respond(status, code, params, extra);
}

/** Lỗi có mã để `throw` trong route (Hono trả nguyên `res`). */
export function apiError<C extends ApiErrorCode>(
  status: ContentfulStatusCode,
  code: C,
  ...args: Args<C>
): HTTPException;
export function apiError(status: ContentfulStatusCode, code: ApiErrorCode, params?: Params, extra?: Extra) {
  return new HTTPException(status, { res: respond(status, code, params, extra) });
}

/** Lỗi chỉ có mã (không có câu cho người dùng; web dịch `errors.<mã>` nếu có) + trường dữ liệu thêm. */
export const codeError = (status: ContentfulStatusCode, error: string, extra: Extra = {}) =>
  new HTTPException(status, { res: Response.json({ error, ...extra }, { status }) });
