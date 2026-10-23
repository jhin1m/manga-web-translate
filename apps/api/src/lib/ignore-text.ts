/**
 * Chữ bỏ qua phía API: mọi regex của người dùng chạy bằng RE2 (thời gian tuyến tính theo độ dài chữ) nên mẫu như
 * `/\w*\w*\w*!/` không thể làm treo tiến trình — việc lọc chạy đồng bộ lúc claim job và khi xem trước / áp ngược.
 * Cú pháp RE2 không có tham chiếu ngược và lookaround; RE2 từ chối thì mục bị báo không hợp lệ.
 */
import { compileIgnoreList, type IgnoreMatcher, ignoreEntryError, type MakeIgnoreRegex } from "@mtl/shared";
import RE2 from "re2";

const re2Regex: MakeIgnoreRegex = (pattern, flags) => new RE2(pattern, flags);

export const compileIgnoreListRe2 = (list: readonly string[]): IgnoreMatcher =>
  compileIgnoreList(list, { makeRegex: re2Regex });

/** Lý do mục không hợp lệ theo RE2 (kèm các kiểm tra chung của shared), null = hợp lệ. */
export const ignoreEntryErrorRe2 = (entry: string): string | null => ignoreEntryError(entry, { makeRegex: re2Regex });
