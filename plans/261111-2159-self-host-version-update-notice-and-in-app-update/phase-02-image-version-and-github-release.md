---
phase: 2
title: "Image: gắn phiên bản + binary compose. CI: tạo GitHub Release tự động sau promote"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 2: Image + CI release

## Overview

1. Build image `mtl` với `MTL_VERSION` lấy từ tag (D17). Build dev hoặc smoke không truyền arg thì là `dev`.
2. Image `mtl` có thêm binary `docker-compose` v2 standalone, để updater và runner (phase 4) chạy compose (D2).
3. `release.yml` thêm job `github-release`. Job chạy **sau** `promote`, chỉ với tag chính thức, đánh dấu Latest theo
   đúng kết quả promote. Ghi chú lấy từ `docs/releases/vX.Y.Z.md`, thiếu thì `--generate-notes` (D16).

Không phụ thuộc phase nào, chạy song song với phase 1.

## Context (đã đọc)

- `infra/docker/app.Dockerfile:36-64`: stage `runtime` (node:24-bookworm-slim). `ENV` ở l.56-60. `RUN test -x …` ở
  l.62. `ENTRYPOINT` ở l.64.
- `.github/workflows/release.yml`:
  - l.17-18 `permissions: contents: read` toàn workflow.
  - l.24-27 job `test` có output `version`, `minor`, `prerelease`.
  - l.62-104 job `image` (matrix `mtl`/`mtl-worker`). `metadata-action` gắn label OCI (l.87-93), trong đó có
    `org.opencontainers.image.version` (báo cáo rc 0.2.0 xác nhận cả hai image có label này).
  - l.105-150 job `promote` tính `newest`/`newest_minor` (l.136-147) để quyết định gắn `:latest`.
- Action ghim theo SHA (comment l.10). Job mới dùng lại đúng SHA `actions/checkout` ở l.45.
- `v0.2.0` đã có Release làm tay ("Latest"). Job mới không được ghi đè.

## Files

| Thao tác | File |
|---|---|
| Sửa | `infra/docker/app.Dockerfile` |
| Sửa | `.github/workflows/release.yml` |

## Implementation steps

1. **`app.Dockerfile`**, stage `runtime`:
   - Binary compose:
     ```dockerfile
     COPY --from=docker:<ver>-cli@sha256:<digest> /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
     ```
     Đường dẫn này và việc gọi thẳng binary như compose standalone đã kiểm thật (research Q7, trên arm64).
     - Image `docker:cli` là multi-arch. Bản compose kèm theo là v5.x. Compose đã đổi số từ v2 sang v5, cùng mã nguồn.
     - Ghim theo digest (index multi-arch), theo cùng lệ "tag dời được, SHA thì không" ở `release.yml:10`.
     - Không dùng `docker/compose-bin`, vì chưa kiểm đường dẫn binary bên trong.
     - Comment ghi bản đã ghim và cách nâng.
     - Cần các tính năng sau (đều có ở v5.x): `depends_on.restart`, `up --wait`, `config --format json`, `replicas: 0`
       (research Q5, Q8).
   - Thêm `&& docker-compose version` vào `RUN test -x …` ở l.62.
   - **Đặt ở cuối stage**, ngay trước `ENTRYPOINT`, để không làm mất cache của các layer trước:
     ```dockerfile
     ARG MTL_VERSION=dev
     ENV MTL_VERSION=$MTL_VERSION
     ```
2. **`release.yml` › job `image`**: thêm `build_args` vào matrix (`mtl`: `MTL_VERSION=${{ needs.test.outputs.version }}`,
   `mtl-worker`: rỗng). Truyền `build-args: ${{ matrix.build_args }}` cho `build-push-action`. Worker không cần biến này
   (YAGNI), nhưng đã có label OCI.
3. **Job `promote`**: thêm `outputs: latest: ${{ steps.tags.outputs.latest }}` (đặt `id: tags` cho step đang có). In
   `latest=true|false` vào `$GITHUB_OUTPUT` theo `VERSION = newest`. Logic chọn tag giữ nguyên.
4. **Job `test`**: tag chính thức mà không có `docs/releases/v$VERSION.md` → `::warning::` (không fail), để người phát
   hành biết Release sẽ dùng ghi chú tự sinh.
5. **Job mới `github-release`**:
   ```yaml
   github-release:
     needs: [test, promote]
     if: needs.test.outputs.prerelease == 'false'
     runs-on: ubuntu-latest
     timeout-minutes: 5
     permissions:
       contents: write            # chỉ job này. Toàn workflow vẫn contents: read
     concurrency: { group: release-notes, cancel-in-progress: false }
     steps:
       - uses: actions/checkout@<SHA như l.45>
       - env: { GH_TOKEN: ${{ github.token }}, VERSION: …, LATEST: ${{ needs.promote.outputs.latest }} }
         run: |
           set -euo pipefail
           tag="v$VERSION"
           if gh release view "$tag" >/dev/null 2>&1; then
             echo "::notice::Release $tag đã có → giữ nguyên (không ghi đè ghi chú làm tay)"; exit 0
           fi
           notes="docs/releases/$tag.md"
           if [ -f "$notes" ]; then
             first="$(head -n1 "$notes")"
             case "$first" in
               "# "*) title="${first#\# }"; tail -n +2 "$notes" > "$RUNNER_TEMP/body.md" ;;
               *)     title="$tag"; cp "$notes" "$RUNNER_TEMP/body.md" ;;
             esac
             gh release create "$tag" --verify-tag --latest="$LATEST" --title "$title" --notes-file "$RUNNER_TEMP/body.md"
           else
             gh release create "$tag" --verify-tag --latest="$LATEST" --title "$tag" --generate-notes
           fi
   ```
   Lý do chạy sau `promote`: Release là nguồn của `releases/latest` mà app hỏi. Release xuất hiện khi `:latest` đã trỏ
   bản mới, nên runner kéo `:latest` sẽ khớp label (D6).
6. Cập nhật comment đầu file (l.1-10): thêm pha `github-release`.

## Tests / kiểm

- `actionlint` (nếu có) hoặc kiểm YAML. Đọc lại diff quyền: chỉ `github-release` có `contents: write`.
- `docker build -f infra/docker/app.Dockerfile --build-arg MTL_VERSION=0.0.0-test -t mtl:vt .`, rồi:
  - `docker run --rm --entrypoint sh mtl:vt -c 'echo $MTL_VERSION; docker-compose version'` → `0.0.0-test` và bản compose đã ghim.
  - Build không có arg → `dev`.
- Chạy thật ở phase 8:
  - Tag rc: không có Release.
  - Tag chính thức: Release "Latest", tiêu đề lấy từ file.
  - Re-run job khi Release đã có: notice, exit 0.

## Done

- Image rc có `MTL_VERSION` = phiên bản của tag, label OCI giữ như cũ, `docker-compose version` chạy được trên amd64 và arm64.
- Tag chính thức tạo đúng 1 Release, "Latest" khi và chỉ khi promote gắn `:latest`.

> Ghi chú 11/11: mã đã xong. Hai mục trên chỉ kiểm được trên Actions thật (image rc, amd64, job `github-release`) → phase 8.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Image app nặng thêm (~60 MB chưa nén) | Chắc chắn×Thấp | Chấp nhận: image worker đã ~1 GB+. Không thêm CLI `docker` đầy đủ (updater gọi Engine API bằng `node:http`) |
| Job Release lỗi sau khi image đã ra | Thấp×TB | Image và `latest` không phụ thuộc Release. Re-run job, hoặc tạo tay theo cùng lệnh. Người dùng chỉ không thấy thông báo |
| Hotfix dòng cũ (1.1.5 khi đã có 1.2.x) bị đánh Latest | Thấp×Cao | `--latest=$LATEST` lấy từ promote: chỉ bản mới nhất mới là Latest |
| `contents: write` bị lạm dụng | Thấp×TB | Chỉ một job, không chạy code của PR (trigger là push tag) |

## Rollback

Revert 2 file. Image cũ vẫn chạy (app coi thiếu `MTL_VERSION` là `dev`). Release đã tạo thì giữ.
