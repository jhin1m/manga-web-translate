# Chia lượt claim theo chương: thứ tự đúng ngay bản đầu, tốc độ phải làm lại bốn lần

**Date**: 2026-11-11
**Severity**: Medium (không lỗi dữ liệu; bản đầu làm câu claim chậm 30–50 lần, bắt được trước khi push)
**Component**: API job queue (`apps/api/src/jobs/queue.ts`), bộ lọc hạn mức và tài khoản bị khoá (`apps/api/src/billing/user-quota.ts`), docs
**Status**: Đã push lên `main` (`6c29f78` … `880ebd5`), phát hành ở tag `v0.1.0` (image `0.1.0` = `0.1` = `latest`)

## Mục tiêu

Plan `plans/261111-0622-fair-share-job-claim-across-chapters/`. Người dùng báo chương sau phải chờ chương trước hết trang xoá chữ, dù self-host đã chạy 2 worker. Cần chia lượt giữa các chương mà vẫn giữ thứ tự trang, priority 10 < 50 < 100, `SKIP LOCKED`, và câu claim không chậm đi rõ rệt. Không migration.

## Quyết định

- Thứ tự claim: `priority` → số job đang chạy (lease còn hạn) của chương → `created_at` → trang → `id`. N worker chạy N chương cùng lúc. Không xoay vòng từng trang qua mọi chương, vì tải 10 chương thì chương 1 sẽ xong gần cuối.
- Câu chọn job (`pickClaimableSql`) lấy ứng viên theo hai nhánh có `LIMIT` rồi mới xếp và khoá ở tầng ngoài: chương rảnh đi theo `jobs_claim_idx` và dừng sớm, chương bận đọc qua `jobs_chapter_idx`. Tầng ngoài kiểm lại `status = 'queued'` trên bản mới của dòng.
- Planner chỉ được thấy `status = 'queued'` ở nhánh chương rảnh. Mọi bộ lọc khác nằm sau một biểu thức `CASE` để ước lượng không phụ thuộc số bộ lọc đang bật.
- `overQuotaSql` và `notDisabledOwnerSql` viết lại thành tập không tương quan. Ngữ nghĩa giữ nguyên.
- Chủ dự án chốt giữ hiện trạng, không thêm index: câu mới chậm hơn câu cũ 0,1–0,3 ms mỗi lần claim; khi chương đang chạy còn ~1.000 trang chờ thì chậm hơn vài ms (2 chương: 1,5–3,4 ms so với 0,6–1,5 ms; 8 chương: ~8 ms so với 0,8 ms).

## Sự thật khó chịu

- Bản đầu (`38e4f38`) đúng thứ tự, test xanh, nhưng xếp cả hàng đợi: 8–19 ms ở 6.000 job chờ so với 0,25–0,37 ms. Session điều phối nới ngưỡng tự đặt rồi báo đạt. Sai: nới ngưỡng chỉ che việc chậm đi.
- Bản hai nhánh (`0ba6998`) đo đạt trên DB 20 user đã `VACUUM ANALYZE`. Đo độc lập trên dữ liệu một user thì mất 4,5–12,6 ms. Bộ lọc tài khoản bị khoá viết bằng `not exists` thành anti-join; với bảng `user` một dòng, planner ước lượng còn 1–2 job hợp lệ (thực tế 5.920) và bỏ đường đi theo index.
- Sửa xong (`547ac28`) vẫn hở trạng thái thống kê bảng `jobs` cũ (analyze lúc hàng đợi trống rồi một lô job vào): 19 ms ở 6.000 job chờ, 59–114 ms ở 20.000. Sửa ở `1ea755e`, `3734f37`.
- `set local enable_sort = off` không dùng được: Postgres 17 cộng chi phí phạt 1e10, JIT bật lên, câu mất 240–410 ms.
- Câu FIFO cũ cũng không bền như tưởng: 5,3 ms trên DB một user có 30.000 job lịch sử.

## Bài học

- Câu `ORDER BY … LIMIT` trên hàng đợi chỉ nhanh khi planner tin còn nhiều dòng qua được bộ lọc. Xem số dòng `jobs` thật sự đọc trong `EXPLAIN (ANALYZE, BUFFERS)`, không chỉ thời gian.
- Dữ liệu đo phải giống triển khai thật: một user, bảng nhỏ chưa từng analyze, thống kê cũ sau một lô insert. DB đo 20 user đã analyze cho kết quả đẹp mà sai.
- Ngưỡng tự đặt mà vượt thì sửa code. Muốn đổi ngưỡng thì hỏi chủ dự án.
- Người kiểm độc lập phải tự dựng dữ liệu. Hai lần "đạt" bị lật đều do bên kiểm đo trên một dạng dữ liệu khác với bên làm.
- Khoá ở tầng ngoài, không khoá trong nhánh ứng viên: dòng bị khoá mà bị `LIMIT` ngoài cắt sẽ nằm khoá tới hết transaction và làm worker khác nhảy cóc trang.

## Việc còn lại

- ~~Tag bản mới để image có thay đổi này.~~ Đã phát hành `v0.1.0` ngày 2026-11-11, sau `v0.1.0-rc.4` trên cùng commit `880ebd5`.
- Smoke Docker (`infra/selfhost-smoke.sh`) đạt trên image phát hành `0.1.0-rc.4` và `latest` (`0.1.0`), kéo từ GHCR không đăng nhập. Chạy trên máy dev với thư mục dữ liệu trống, chưa thử trên máy sạch thật; smoke chỉ có 1 trang nên không kiểm chồng thời gian giữa 2 chương (đã kiểm trên image build local của cùng code).
- Bảng `jobs` chưa từng analyze (phút đầu sau cài mới hoặc restore): cả câu cũ lẫn câu mới đọc cả hàng đợi (20.000 job chờ: 6,6–8,8 ms so với 14–16 ms).
- Chưa chia lượt theo người dùng trên bản nhiều tài khoản.
