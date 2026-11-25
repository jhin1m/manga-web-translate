import { tmpdir } from "node:os";
import { join } from "node:path";

/** Thư mục file riêng cho test API (global-setup xoá sạch mỗi lượt chạy) — không đụng `.data/files` của dev. */
export const TEST_FILES_DIR = join(tmpdir(), "mtl-api-test-files");
