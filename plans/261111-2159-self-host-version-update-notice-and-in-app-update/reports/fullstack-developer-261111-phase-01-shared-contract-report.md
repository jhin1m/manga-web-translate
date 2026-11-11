# Báo cáo phase 01: hợp đồng chung

Trạng thái: completed. Subpath: `@mtl/shared/update` (cũng re-export từ `@mtl/shared`).

## Exports của `packages/shared/src/update.ts`
- `type ParsedVersion = { major: number; minor: number; patch: number; pre: string[] }`
- `parseVersion(s: string): ParsedVersion | null` (bỏ 1 chữ `v` đầu; sai/`dev`/`+build` -> null)
- `compareVersions(a: string, b: string): -1 | 0 | 1 | null` (null khi một bên không parse được)
- `isNewer(candidate: string, current: string): boolean` (false nếu có bên sai định dạng)
- `isPrerelease(v: string): boolean`
- `RELEASE_REPO = "jhin1m/manga-web-translate"`
- `releaseUrl(v: string): string`, `composeUrl(ref: string): string`
- `UPDATER_PORT = 8090`, `UPDATER_TOKEN_FILE = "updater-token"`
- `runnerName(project: string): string` -> `${project}-update`
- `ALLOWED_IMAGE_REPOS = ["ghcr.io/jhin1m/mtl", "ghcr.io/jhin1m/mtl-worker", "postgres"] as const` (không có helper chuẩn hoá; phase 4 tự chuẩn hoá `postgres` -> `docker.io/library/postgres`)
- `UPDATE_REASONS` (21 mã đúng thứ tự phase file), `type UpdateReason`
- `UPDATE_STEPS = ["preflight","download","pull","verify","apply","check","done"]`, `type UpdateStep`
- `type UpdateRun`, `type UpdaterStatus`, `type UpdateStatus` (đúng như phase file)

## Files
- Tạo `packages/shared/src/update.ts`, `packages/shared/test/update.test.ts`
- Sửa `packages/shared/src/index.ts` (+1 dòng), `packages/shared/package.json` (+`"./update"`)

## Kết quả
- `pnpm --filter @mtl/shared test`: 9 file, 114 test pass (gồm mọi ca trong bảng phase + `rc` < `rc.1`, số < chữ, `vv1.2.3`, `1.2.3-01`).
- `pnpm typecheck` xanh toàn repo; `pnpm lint` (biome) sạch, 444 file.
- tsx từ `apps/api` import `@mtl/shared/update` chạy được (`compareVersions("0.10.0","0.9.0")` = 1); file tạm đã xoá.
- Chưa thử từ vite (apps/web); module không import gì nên không có rủi ro resolve, phase 5 sẽ xác nhận.
