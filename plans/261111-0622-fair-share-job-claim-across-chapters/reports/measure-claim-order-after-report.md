# Đo câu chọn job sau khi sửa: chia lượt theo chương + bộ lọc hạn mức mới

Ngày đo: 2026-11-11. Postgres 17.11 (container `mtl-dev-postgres-1`, arm64). DB tạm `mtl_claim_bench` tạo từ template
DB test của API, **đã xoá sau khi đo**. Không đụng DB dev.

## Kết luận

**Đạt mục tiêu đo ở cả 192 ô của lượt đo 4: câu mới ≤ câu cũ + 0,45 ms, không tăng theo độ dài hàng đợi, ở cả hai trạng
thái thống kê của bảng `jobs` (mới và cũ) và cả ba dạng dữ liệu.** Nhánh chương rảnh đi theo `jobs_claim_idx` ở mọi ô có
từ 2.000 job chờ trở lên; số dòng `jobs` câu mới đọc là hằng số (158–269 dòng) từ 78 tới 20.000 job chờ, trừ một ô nêu
dưới.

Bốn bản của thay đổi này:

1. **Một câu, xếp cả hàng đợi** (`38e4f38`): 8–19 ms ở 6.000 job chờ. Bị bác. Số đo ở "Lượt đo 1".
2. **Hai nhánh có LIMIT** (`0ba6998`, `8256523`): đạt trên DB 20 user đã `VACUUM ANALYZE` (lượt đo 2), **không đạt trên
   dữ liệu self-host thật**: với 1 user và bảng `user` chưa analyze, nhánh chương rảnh chạy Seq Scan + xếp cả hàng đợi
   (người điều phối đo 4,5–12,6 ms; tôi tái hiện 3,7–4,6 ms ở 6.000 job chờ).
3. **Ước lượng không phụ thuộc bộ lọc** (`547ac28`): đạt ở lượt đo 3 (thống kê mới), **không đạt khi thống kê bảng `jobs`
   cũ**. Reviewer tìm ra, tôi tái hiện: analyze lúc hàng đợi trống rồi một lô job vào → 22,7 ms ở 6.000 job chờ, đọc
   12.039 dòng `jobs` (câu cũ: 0,15–0,27 ms, 40 dòng).
4. **Bản hiện tại** (`1ea755e`, `3734f37`): số đo ở "Lượt đo 4" (đo ở `3734f37`; lượt đo ngay trước đó ở `1ea755e` cho
   cùng kết quả trong ma trận, chênh nhiều nhất cũng +0,45 ms).

Vì sao bản 3 hỏng khi thống kê cũ, và sửa thế nào (không migration, không index, không GUC):

- Planner tưởng chỉ có 1 job `queued`. Ở nhánh chương bận và ở phép ghép `cand join jobs` của tầng khoá, nó chọn quét
  `jobs_claim_idx` (tưởng 1 dòng, thật ra cả hàng đợi) rồi lặp cho từng ứng viên. Sửa: ở hai chỗ đó `status = 'queued'`
  cũng nằm trong lớp bọc `CASE`, nên chỉ còn đường qua `jobs_chapter_idx` và khoá chính. Tầng khoá vẫn kiểm lại status
  trên bản mới của dòng (bỏ điều kiện đó thì test 4 luồng claim trên 6 chương đỏ vì trùng job, 2/2 lần).
- Cũng với ước lượng 1 dòng, nhánh chương rảnh có thể chọn xếp toàn bộ thay cho xếp tăng dần khi phải xếp thêm theo
  trang và id, và đọc hết hàng đợi (test mới bắt được: 3.000 dòng). Sửa: nhánh này chỉ xếp theo đúng hai cột của index
  `(priority, created_at)` và lấy trọn nhóm hoà cuối (`fetch first … rows with ties`), nên không còn bước xếp nào
  trên bảng `jobs`; tập vừa cắt mới được xếp theo trang + id và cắt lại còn `max + 32` dòng (`3734f37`, theo review:
  không cắt lại thì cả chương 1.000 trang bị đẩy lên tầng khoá, chậm thêm ~0,7 ms). Nhánh này vẫn để lộ `status = 'queued'` cho planner để chứng minh điều kiện
  của partial index.

Giới hạn còn lại (đều có số đo):

- **Dạng A, thống kê mới, 1.998 job chờ:** chênh +0,45 ms (lớn nhất ma trận). Tầng khoá ghép bằng Hash Join + Seq Scan
  bảng `jobs` (bảng lúc đó chỉ có 2.000 dòng) nên đọc 2.201 dòng. Planner chỉ chọn cách này khi cả bảng `jobs` nhỏ; từ
  6.000 dòng trở lên nó dùng khoá chính.
- **78 job chờ, dạng A, thống kê mới:** nhánh chương rảnh có ô dùng Seq Scan (bảng 80 dòng); 0,28–0,37 ms.
- **Ngoài ma trận (1), đầu hàng là chương đang bận với backlog lớn** (2 chương × 999 job chờ): câu mới 1,5–3,4 ms khi
  không hạn mức, câu cũ 0,6–1,5 ms; chênh +1,2 đến +1,9 ms, như nhau ở cả hai trạng thái thống kê. **Đây là chỗ câu mới
  vượt câu cũ quá 1 ms.** Chi phí theo số job chờ của các chương đang chạy (tối đa số worker × 1.000 trang), không theo
  độ dài hàng đợi; nhánh chương rảnh vẫn đi theo index. Reviewer đo thêm 8 chương bận × 1.000 job chờ: 8,3 ms (câu cũ
  0,78 ms). Có hạn mức thì câu cũ ở trường hợp 2 chương mất 59–95 ms, câu mới 2,0–5,0 ms. Muốn ép nốt cần index
  `(chapter_id, priority, created_at)`, tức migration.
- **Ngoài ma trận (2), đầu hàng là chương rảnh 1.000 trang:** câu mới 0,85–1,8 ms, câu cũ 0,6–1,4 ms, chênh nhiều nhất
  +0,36 ms. Cả hai câu đều phải đọc trọn nhóm 1.000 job cùng `created_at`.
- **Bảng `jobs` và `pages` chưa từng analyze** (khoảng một phút đầu của bản cài mới, hoặc ngay sau restore): mọi bản
  đều đọc cả hàng đợi. Reviewer đo ở 20.000 job chờ: bản `1ea755e` 6,6–8,8 ms, câu FIFO cũ 14–16 ms. Tôi không tự đo
  trạng thái này.

## Lượt đo 4 (commit `3734f37`): hai trạng thái thống kê × ba dạng dữ liệu

Cách đo như các lượt trước: câu cũ (`ef1e70c`) và câu mới chạy xen kẽ trong một phiên `psql`, 9 vòng sau 1 vòng làm
nóng, `\timing`, trung vị, gồm lập kế hoạch; ms. Mỗi dòng của bảng gộp 8 ô (mac / modal × có / không hạn mức × breaker
tắt / bật); cả 8 ô của một dòng cho cùng một nút đọc. DB tạm tạo lại cho từng dòng, đã xoá sau khi đo.

- **Thống kê mới:** `ANALYZE jobs` sau khi lô job đã vào hàng (dạng 20 user: `VACUUM ANALYZE` toàn DB).
- **Thống kê cũ:** `ANALYZE jobs` khi bảng chỉ có job đã xong (dạng A: 80 job; B và 20 user: 30.000 job), sau đó mới
  chèn job chờ và job đang chạy, tắt autovacuum của bảng `jobs` để nó không tự analyze lại giữa lượt đo. Planner khi đó
  ước lượng 0–1 job `queued`.
- Dạng A / B: 1 user, `page.prepare` OCR local, bảng `user` không có thống kê. Dạng 20 user: job gọi LLM, 20.000 dòng
  ledger hôm nay.
- "Dòng `jobs` đọc" = tổng (dòng trả về + dòng bị bộ lọc loại) × số lần lặp của mọi nút đọc bảng `jobs` trong
  `EXPLAIN (ANALYZE)`.

| Dạng | Thống kê `jobs` | Job chờ | Không hạn mức: cũ → mới | Có hạn mức, modal: cũ → mới | Chênh lớn nhất (8 ô) | Nhánh chương rảnh đọc `jobs` bằng | Dòng `jobs` đọc: cũ / mới |
|---|---|---|---|---|---|---|---|
| A: 1 user, không lịch sử | mới | 78 | 0,15–0,19 → 0,29–0,35 | 2,52–2,54 → 0,43–0,46 | +0,17 | Seq Scan, jobs_claim_idx | 40 / 158–240 |
| A: 1 user, không lịch sử | mới | 1.998 | 0,13–0,16 → 0,51–0,61 | 2,51–2,56 → 0,65–0,72 | +0,45 | jobs_claim_idx | 40 / 2201 |
| A: 1 user, không lịch sử | mới | 5.998 | 0,13–0,17 → 0,36–0,46 | 2,46–2,51 → 0,50–0,54 | +0,29 | jobs_claim_idx | 40 / 269 |
| A: 1 user, không lịch sử | mới | 19.998 | 0,13–0,17 → 0,37–0,45 | 2,49–2,49 → 0,50–0,58 | +0,28 | jobs_claim_idx | 40 / 269 |
| A: 1 user, không lịch sử | cũ | 78 | 0,12–0,17 → 0,29–0,36 | 4,73–4,75 → 0,43–0,48 | +0,20 | jobs_claim_idx | 78 / 158 |
| A: 1 user, không lịch sử | cũ | 1.998 | 0,12–0,17 → 0,34–0,42 | 3,73–3,74 → 0,49–0,52 | +0,26 | jobs_claim_idx | 40 / 187 |
| A: 1 user, không lịch sử | cũ | 5.998 | 0,12–0,17 → 0,34–0,47 | 2,54–2,59 → 0,52–0,52 | +0,30 | jobs_claim_idx | 40 / 187 |
| A: 1 user, không lịch sử | cũ | 19.998 | 0,12–0,17 → 0,36–0,47 | 2,49–2,50 → 0,51–0,54 | +0,30 | jobs_claim_idx | 40 / 187 |
| B: 1 user, 30.000 job cũ | mới | 78 | 0,12–0,17 → 0,33–0,38 | 2,50–2,51 → 0,45–0,50 | +0,22 | jobs_claim_idx | 40 / 195 |
| B: 1 user, 30.000 job cũ | mới | 1.998 | 0,13–0,17 → 0,38–0,46 | 3,76–3,85 → 0,51–0,58 | +0,29 | jobs_claim_idx | 40 / 269 |
| B: 1 user, 30.000 job cũ | mới | 5.998 | 0,16–0,17 → 0,42–0,52 | 2,51–2,53 → 0,51–0,56 | +0,35 | jobs_claim_idx | 40 / 269 |
| B: 1 user, 30.000 job cũ | mới | 19.998 | 0,13–0,18 → 0,38–0,45 | 2,51–2,57 → 0,52–0,56 | +0,29 | jobs_claim_idx | 40 / 269 |
| B: 1 user, 30.000 job cũ | cũ | 78 | 0,12–0,16 → 0,33–0,38 | 2,48–2,52 → 0,47–0,50 | +0,23 | jobs_claim_idx | 40 / 195 |
| B: 1 user, 30.000 job cũ | cũ | 1.998 | 0,13–0,17 → 0,38–0,45 | 3,76–3,86 → 0,53–0,58 | +0,28 | jobs_claim_idx | 40 / 269 |
| B: 1 user, 30.000 job cũ | cũ | 5.998 | 0,13–0,16 → 0,37–0,43 | 2,47–2,52 → 0,52–0,57 | +0,27 | jobs_claim_idx | 40 / 269 |
| B: 1 user, 30.000 job cũ | cũ | 19.998 | 0,13–0,17 → 0,37–0,44 | 2,52–2,57 → 0,51–0,57 | +0,28 | jobs_claim_idx | 40 / 269 |
| 20 user | mới | 78 | 0,13–0,18 → 0,32–0,44 | 3,90–3,97 → 2,35–2,39 | +0,26 | jobs_claim_idx | 40 / 195 |
| 20 user | mới | 1.998 | 0,13–0,20 → 0,41–0,51 | 3,92–3,96 → 2,23–2,28 | +0,32 | jobs_claim_idx | 40 / 269 |
| 20 user | mới | 5.998 | 0,13–0,19 → 0,41–0,51 | 3,87–3,96 → 2,22–2,33 | +0,32 | jobs_claim_idx | 40 / 269 |
| 20 user | mới | 19.998 | 0,13–0,20 → 0,40–0,50 | 3,91–4,00 → 2,30–2,46 | +0,31 | jobs_claim_idx | 40 / 269 |
| 20 user | cũ | 78 | 0,13–0,20 → 0,33–0,48 | 3,87–3,96 → 2,27–2,37 | +0,28 | jobs_claim_idx | 40 / 195 |
| 20 user | cũ | 1.998 | 0,13–0,21 → 0,41–0,56 | 3,91–3,98 → 2,19–2,30 | +0,35 | jobs_claim_idx | 40 / 269 |
| 20 user | cũ | 5.998 | 0,13–0,19 → 0,41–0,53 | 3,92–3,94 → 2,26–2,32 | +0,34 | jobs_claim_idx | 40 / 269 |
| 20 user | cũ | 19.998 | 0,13–0,19 → 0,41–0,54 | 3,90–4,01 → 2,26–2,37 | +0,35 | jobs_claim_idx | 40 / 269 |

Ngoài ma trận (1), đầu hàng là 2 chương **đang bận** × 999 job chờ (21.918 job chờ):

| Dạng | Thống kê `jobs` | Không hạn mức: cũ → mới | Có hạn mức, modal: cũ → mới | Chênh lớn nhất | Nhánh chương rảnh | Dòng `jobs` đọc: cũ / mới |
|---|---|---|---|---|---|---|
| A: 1 user, không lịch sử | mới | 0,62–0,78 → 1,52–1,92 | 59,91–60,40 → 2,03–2,21 | +1,16 | jobs_claim_idx | 1000 / 4109 |
| A: 1 user, không lịch sử | cũ | 0,61–0,83 → 1,53–2,08 | 90,31–90,76 → 1,99–2,01 | +1,25 | jobs_claim_idx | 1000 / 2107 |
| B: 1 user, 30.000 job cũ | mới | 0,70–0,95 → 1,70–2,22 | 59,87–60,37 → 1,98–2,27 | +1,27 | jobs_claim_idx | 1000 / 4109 |
| B: 1 user, 30.000 job cũ | cũ | 0,72–0,94 → 1,72–2,22 | 59,35–59,57 → 1,95–2,12 | +1,28 | jobs_claim_idx | 1000 / 4109 |
| 20 user | mới | 0,73–1,38 → 1,76–3,08 | 93,80–94,81 → 3,63–4,97 | +1,70 | jobs_claim_idx | 1000 / 4109 |
| 20 user | cũ | 0,75–1,51 → 1,86–3,36 | 94,51–94,80 → 3,79–5,01 | +1,85 | jobs_claim_idx | 1000 / 4109 |

Ngoài ma trận (2), đầu hàng là 2 chương **rảnh** × 1.000 job cùng `created_at` (2 job đang chạy ở chương khác):

| Dạng | Thống kê `jobs` | Không hạn mức: cũ → mới | Có hạn mức, modal: cũ → mới | Chênh lớn nhất | Nhánh chương rảnh | Dòng `jobs` đọc: cũ / mới |
|---|---|---|---|---|---|---|
| A: 1 user, không lịch sử | mới | 0,63–0,90 → 0,88–1,26 | 59,07–59,37 → 1,10–1,22 | +0,36 | jobs_claim_idx | 1001 / 1229 |
| A: 1 user, không lịch sử | cũ | 0,61–0,78 → 0,85–1,11 | 90,02–91,02 → 1,12–1,21 | +0,33 | jobs_claim_idx | 1001 / 1147 |
| B: 1 user, 30.000 job cũ | mới | 0,73–1,01 → 0,99–1,35 | 90,36–90,57 → 1,27–1,36 | +0,34 | jobs_claim_idx | 1001 / 1229 |
| B: 1 user, 30.000 job cũ | cũ | 0,72–1,04 → 0,96–1,37 | 89,92–90,66 → 1,25–1,29 | +0,33 | jobs_claim_idx | 1001 / 1229 |
| 20 user | mới | 0,74–1,41 → 1,00–1,77 | 93,89–95,70 → 2,87–3,83 | +0,36 | jobs_claim_idx | 1001 / 1229 |
| 20 user | cũ | 0,74–1,44 → 1,00–1,80 | 94,74–95,52 → 2,97–3,74 | +0,36 | jobs_claim_idx | 1001 / 1229 |

## Lượt đo 3 (commit `547ac28`): chưa đủ, chỉ đo với thống kê `jobs` mới

Cùng máy và cách đo với lượt 2 (ba câu xen kẽ trong một phiên `psql`, 9 vòng sau 1 vòng làm nóng, `\timing`, trung vị,
gồm lập kế hoạch; ms). DB tạm `mtl_claim_bench`, tạo lại cho từng cỡ hàng đợi, đã xoá sau khi đo.

- **Dạng A:** 1 user sở hữu mọi job, không có job lịch sử, `page.prepare` OCR local (như self-host), 2 job đang chạy ở 2
  chương cũ nhất, chỉ `ANALYZE jobs; ANALYZE pages`, xoá thống kê cột của bảng `user` (như chưa từng analyze:
  `reltuples = -1`, không có dòng `pg_statistic`).
- **Dạng B:** như A, thêm 30.000 job `succeeded` của 750 chương cũ.
- **Dạng 20 user:** ma trận của lượt 2 (job gọi LLM, 20.000 dòng ledger, `VACUUM ANALYZE`).
- Hạn mức ở dạng A / B: 1.000 dòng ledger hôm nay của user duy nhất. Với token mac, job OCR local không phải job LLM
  nên bộ lọc hạn mức không cộng ledger; chỉ token modal mới cộng.
- "Xếp cả hàng đợi" = `ORDER BY` thẳng theo số job đang chạy (bản 1), dùng bộ lọc hiện tại.
- Hai cột cuối lấy từ `EXPLAIN (ANALYZE, BUFFERS)`: nút đọc bảng `jobs` trong nhánh chương rảnh của câu mới, và trong
  câu cũ, kèm số dòng thật đọc được.

### Dạng A: 1 user, không lịch sử job, `user` không có thống kê


**78 job chờ (2 chương, đều đang bận)**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,17 | 0,19 | 0,32 (0,36) | +0,15 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,18 | 0,21 | 0,36 (0,55) | +0,18 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,15 | 0,17 | 0,30 (0,34) | +0,15 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,19 | 0,20 | 0,34 (0,40) | +0,15 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 0,17 | 0,18 | 0,31 (0,42) | +0,14 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 0,18 | 0,20 | 0,35 (0,40) | +0,17 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 2,51 | 0,29 | 0,42 (0,46) | −2,09 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 2,54 | 0,32 | 0,47 (0,52) | −2,07 | Seq Scan (0 dòng) | `jobs_claim_idx` (40 dòng) |

**5.998 job chờ**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,14 | 3,46 | 0,42 (0,51) | +0,28 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,17 | 3,69 | 0,47 (0,62) | +0,30 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,13 | 2,99 | 0,40 (0,46) | +0,27 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,15 | 3,27 | 0,43 (0,60) | +0,28 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 0,14 | 3,39 | 0,42 (0,51) | +0,28 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 0,16 | 3,70 | 0,49 (0,54) | +0,33 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 2,50 | 3,25 | 0,54 (0,66) | −1,96 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 3,83 | 3,54 | 0,58 (0,66) | −3,25 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |

**19.998 job chờ**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,15 | 12,08 | 0,53 (0,60) | +0,38 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,17 | 12,93 | 0,51 (0,56) | +0,34 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,14 | 10,63 | 0,48 (0,66) | +0,34 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,17 | 11,65 | 0,50 (0,55) | +0,33 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 0,15 | 11,97 | 0,47 (0,59) | +0,32 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 0,18 | 12,77 | 0,50 (0,56) | +0,32 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 2,50 | 10,91 | 0,57 (0,66) | −1,93 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 2,53 | 11,73 | 0,59 (0,77) | −1,94 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |

### Dạng B: 1 user, 30.000 job succeeded, `user` không có thống kê


**78 job chờ (2 chương, đều đang bận)**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,15 | 0,21 | 0,37 (0,40) | +0,22 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,16 | 0,22 | 0,37 (0,43) | +0,21 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,12 | 0,18 | 0,33 (0,38) | +0,21 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,15 | 0,21 | 0,37 (0,42) | +0,22 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 0,14 | 0,20 | 0,35 (0,39) | +0,21 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 0,16 | 0,22 | 0,38 (0,45) | +0,22 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 2,48 | 0,33 | 0,49 (0,58) | −1,99 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 2,58 | 0,37 | 0,51 (0,58) | −2,07 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |

**5.998 job chờ**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,16 | 6,04 | 0,62 (0,82) | +0,46 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,17 | 6,01 | 0,57 (0,70) | +0,40 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,14 | 5,10 | 0,48 (0,62) | +0,34 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,16 | 5,68 | 0,56 (0,64) | +0,40 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 0,15 | 5,71 | 0,53 (0,89) | +0,38 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 0,17 | 6,09 | 0,59 (0,69) | +0,42 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 2,51 | 5,44 | 0,66 (0,79) | −1,85 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 2,58 | 6,37 | 0,82 (0,97) | −1,76 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |

**19.998 job chờ**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,17 | 17,56 | 0,65 (0,74) | +0,48 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,18 | 18,42 | 0,64 (0,76) | +0,46 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,15 | 15,37 | 0,58 (0,80) | +0,43 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,18 | 16,68 | 0,65 (0,79) | +0,47 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 0,17 | 16,72 | 0,59 (0,68) | +0,42 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 0,18 | 17,91 | 0,58 (0,69) | +0,40 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 2,51 | 15,45 | 0,66 (0,74) | −1,85 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 2,56 | 16,93 | 0,73 (0,81) | −1,83 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |

### Dạng 20 user (ma trận cũ, `VACUUM ANALYZE` toàn DB)


**78 job chờ (2 chương, đều đang bận)**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,14 | 0,21 | 0,34 (0,55) | +0,20 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,19 | 0,27 | 0,45 (0,51) | +0,26 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,13 | 0,18 | 0,33 (0,38) | +0,20 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,17 | 0,26 | 0,42 (0,47) | +0,25 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 4,03 | 2,06 | 2,21 (2,52) | −1,82 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 4,08 | 2,12 | 2,28 (2,34) | −1,80 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 3,93 | 2,00 | 2,16 (2,20) | −1,77 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 4,08 | 2,15 | 2,30 (2,50) | −1,78 | `jobs_claim_idx` (0 dòng) | `jobs_claim_idx` (40 dòng) |

**5.998 job chờ**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,16 | 5,82 | 0,58 (0,81) | +0,42 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,21 | 9,32 | 0,73 (0,75) | +0,52 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,14 | 5,32 | 0,53 (0,68) | +0,39 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,20 | 8,88 | 0,67 (0,75) | +0,47 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 4,04 | 8,05 | 2,62 (2,87) | −1,42 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 4,03 | 11,24 | 2,65 (2,89) | −1,38 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 4,00 | 7,59 | 2,54 (2,77) | −1,46 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 4,10 | 11,10 | 2,70 (3,08) | −1,40 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |

**19.998 job chờ**

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | Nhánh chương rảnh đọc `jobs` bằng | Câu cũ đọc `jobs` bằng |
|---|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,17 | 19,06 | 0,70 (0,81) | +0,53 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | mac | bật | 0,26 | 30,24 | 0,91 (0,97) | +0,65 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | tắt | 0,15 | 17,27 | 0,62 (0,75) | +0,47 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| không | modal | bật | 0,20 | 27,47 | 0,66 (0,78) | +0,46 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | tắt | 4,19 | 21,81 | 2,69 (2,96) | −1,50 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | mac | bật | 4,11 | 30,50 | 2,62 (2,74) | −1,49 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | tắt | 4,12 | 19,29 | 2,50 (3,03) | −1,62 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |
| có | modal | bật | 4,12 | 29,95 | 2,66 (3,04) | −1,46 | `jobs_claim_idx` (41 dòng) | `jobs_claim_idx` (40 dòng) |

### Quét cỡ hàng đợi (dạng A và B, gộp 8 ô mỗi cỡ)

| Dạng | Job chờ | Câu cũ | Câu mới | Chênh lớn nhất | Nhánh chương rảnh |
|---|---|---|---|---|---|
| A | 78 | 0,15–2,54 | 0,30–0,47 | +0,18 | Seq Scan |
| A | 200 | 0,12–2,55 | 0,37–0,56 | +0,26 | Seq Scan, jobs_claim_idx |
| A | 480 | 0,12–2,56 | 0,36–0,57 | +0,30 | jobs_claim_idx |
| A | 1000 | 0,12–2,51 | 0,39–0,57 | +0,31 | jobs_claim_idx |
| A | 2000 | 0,12–2,55 | 0,46–0,66 | +0,40 | jobs_claim_idx |
| A | 6000 | 0,13–3,83 | 0,40–0,58 | +0,33 | jobs_claim_idx |
| A | 20000 | 0,14–2,53 | 0,47–0,59 | +0,38 | jobs_claim_idx |
| B | 78 | 0,12–2,58 | 0,33–0,51 | +0,22 | jobs_claim_idx |
| B | 200 | 0,13–2,55 | 0,38–0,57 | +0,30 | jobs_claim_idx |
| B | 480 | 0,13–2,55 | 0,40–0,62 | +0,32 | jobs_claim_idx |
| B | 1000 | 0,13–2,53 | 0,39–0,60 | +0,32 | jobs_claim_idx |
| B | 2000 | 0,13–2,53 | 0,41–0,60 | +0,33 | jobs_claim_idx |
| B | 6000 | 0,14–2,58 | 0,48–0,82 | +0,46 | jobs_claim_idx |
| B | 20000 | 0,15–2,56 | 0,58–0,73 | +0,48 | jobs_claim_idx |

### Ngoài ma trận: đầu hàng là 2 chương bận × 999 job chờ (21.918 job chờ)

| Dạng | Không hạn mức: cũ → mới | Có hạn mức, modal: cũ → mới | Chênh lớn nhất | Nhánh chương rảnh |
|---|---|---|---|---|
| A | 0,61–0,77 → 1,56–1,97 | 59,47–59,67 → 1,81–1,98 | +1,23 | jobs_claim_idx (41 dòng) |
| B | 0,73–0,91 → 2,02–2,31 | 59,83–91,20 → 2,19–2,39 | +1,44 | jobs_claim_idx (41 dòng) |
| 20 user | 0,75–1,44 → 2,05–3,60 | 96,01–97,03 → 4,09–5,50 | +2,16 | jobs_claim_idx (41 dòng) |

Ở 78 job chờ cả hai chương đều đang bận nên nhánh chương rảnh không trả dòng nào (0 dòng); planner chọn Seq Scan ở dạng
A vì bảng `jobs` khi đó chỉ có 80 dòng.

## Lượt đo 2 (bản hai nhánh, commit `8256523`): chưa đủ, chỉ đúng với DB 20 user đã analyze toàn bộ

Cùng máy, cùng cách đo với lượt 1, DB tạm `mtl_claim_bench` đã xoá sau khi đo.

- Dữ liệu như lượt 1 (20 user, 30.000 job lịch sử, 20.000 dòng ledger hôm nay + 50 dòng `user_id` NULL, 2 job đang
  chạy thuộc 2 chương cũ nhất đang chờ, payload `page.prepare` gọi LLM có 2 slot). Hàng đợi 19.998 job = 500 chương ×
  40 trang (110.000 trang); 5.998 và 78 job là cùng DB sau khi huỷ bớt job chờ rồi `VACUUM ANALYZE`.
- Ba câu đo xen kẽ trong cùng phiên `psql`, 9 vòng sau 1 vòng làm nóng, `\timing`, trung vị. Thời gian gồm cả lập kế
  hoạch (câu gửi dạng văn bản, `LIMIT 1`).
  - "Câu cũ": commit `ef1e70c` (FIFO + bộ lọc hạn mức tương quan).
  - "Xếp cả hàng đợi": commit `38e4f38`.
  - "Câu mới": `pickClaimableSql()` ở `8256523` (đã có `cand as materialized`), SQL lấy từ `PgDialect.sqlToQuery()`.
    Bảng dưới là lượt đo sau khi thêm `materialized`; lượt đo ngay trước đó (chưa có) cho kết quả tương đương
    (chênh nhiều nhất +0,68 ms).
- Cột "EXPLAIN" là `Execution Time` của `EXPLAIN (ANALYZE, BUFFERS)`, không gồm lập kế hoạch.
- Đơn vị ms.

### 5.998 job chờ

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,18 | 10,72 | 0,72 (0,92) | +0,54 | 0,178 / 0,731 |
| không | mac | bật | 0,22 | 12,32 | 0,81 (0,99) | +0,59 | 0,205 / 0,874 |
| không | modal | tắt | 0,16 | 10,08 | 0,66 (1,15) | +0,5 | 0,162 / 0,663 |
| không | modal | bật | 0,26 | 14,88 | 1,04 (1,53) | +0,78 | 0,221 / 0,85 |
| có | mac | tắt | 4,36 | 13,03 | 2,85 (3,06) | -1,51 | 5,013 / 3,202 |
| có | mac | bật | 4,26 | 16,54 | 3,0 (3,34) | -1,26 | 6,011 / 3,398 |
| có | modal | tắt | 4,35 | 13,22 | 2,86 (3,11) | -1,49 | 5,162 / 3,111 |
| có | modal | bật | 4,81 | 17,9 | 3,33 (4,16) | -1,48 | 5,959 / 3,266 |

### 19.998 job chờ

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,17 | 18,09 | 0,63 (0,83) | +0,46 | 0,171 / 0,612 |
| không | mac | bật | 0,21 | 28,95 | 0,73 (0,82) | +0,52 | 0,203 / 0,649 |
| không | modal | tắt | 0,16 | 17,44 | 0,65 (0,8) | +0,49 | 0,156 / 0,589 |
| không | modal | bật | 0,21 | 29,79 | 0,83 (1,06) | +0,62 | 0,229 / 0,727 |
| có | mac | tắt | 4,31 | 22,6 | 2,77 (2,89) | -1,54 | 4,88 / 2,884 |
| có | mac | bật | 4,3 | 33,94 | 2,81 (3,05) | -1,49 | 5,477 / 3,83 |
| có | modal | tắt | 4,33 | 21,2 | 2,72 (3,2) | -1,61 | 5,258 / 3,21 |
| có | modal | bật | 4,35 | 31,89 | 2,86 (3,47) | -1,49 | 4,885 / 2,934 |

### 78 job chờ

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,18 | 0,27 | 0,5 (0,66) | +0,32 | 0,215 / 0,603 |
| không | mac | bật | 0,21 | 0,31 | 0,62 (0,72) | +0,41 | 0,204 / 0,551 |
| không | modal | tắt | 0,14 | 0,2 | 0,43 (0,54) | +0,29 | 0,16 / 0,464 |
| không | modal | bật | 0,19 | 0,27 | 0,52 (0,58) | +0,33 | 0,186 / 0,579 |
| có | mac | tắt | 4,05 | 2,12 | 2,38 (2,72) | -1,67 | 4,738 / 2,849 |
| có | mac | bật | 4,16 | 2,26 | 2,51 (2,65) | -1,65 | 4,888 / 2,816 |
| có | modal | tắt | 4,0 | 2,1 | 2,35 (2,51) | -1,65 | 4,694 / 2,962 |
| có | modal | bật | 4,27 | 2,32 | 2,51 (2,69) | -1,76 | 4,764 / 3,007 |

### 21.918 job chờ, đầu hàng là 2 chương bận × 999 job chờ (ngoài ma trận)

| Hạn mức | Token | Breaker | Câu cũ | Xếp cả hàng đợi | Câu mới (max) | Mới − cũ | EXPLAIN cũ / mới |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 1,08 | 23,43 | 3,43 (4,03) | +2,35 | 1,949 / 3,426 |
| không | mac | bật | 1,62 | 35,99 | 4,19 (10,35) | +2,57 | 3,542 / 5,548 |
| không | modal | tắt | 0,87 | 20,01 | 2,75 (3,44) | +1,88 | 1,723 / 3,397 |
| không | modal | bật | 1,41 | 30,48 | 3,56 (3,7) | +2,15 | 2,168 / 4,815 |
| có | mac | tắt | 96,3 | 23,22 | 4,48 (5,53) | -91,82 | 109,411 / 5,273 |
| có | mac | bật | 95,57 | 34,13 | 5,65 (6,51) | -89,92 | 115,202 / 6,641 |
| có | modal | tắt | 104,95 | 22,83 | 5,06 (5,62) | -99,89 | 113,677 / 5,328 |
| có | modal | bật | 101,42 | 34,11 | 5,93 (7,39) | -95,49 | 116,175 / 6,746 |

### Vì sao câu mới không còn theo độ dài hàng đợi

`EXPLAIN (ANALYZE, BUFFERS)` ô 5.998 job, modal, có hạn mức, breaker bật.

Câu cũ (4,83 ms, 11.988 buffer): đi theo index và dừng sau 40 dòng, nhưng cộng lại ledger cho từng dòng.

```
Limit → LockRows → Incremental Sort (priority, created_at | ord, id)
  Index Scan jobs_claim_idx on jobs            rows=40
    SubPlan hạn mức: Bitmap Heap Scan usage_ledger rows=1000 loops=40     ← 11.801 buffer
  Index Scan pages_pkey                        loops=40
```

Câu mới (khoảng 3 ms khi có đo đạc, ~1.200 buffer; plan chụp ở bản chưa `materialized`, bản cuối chỉ khác ở chỗ `cand`
được đọc một lần vào bộ nhớ rồi mới ghép với `jobs`):

```
CTE busy:       Index Scan jobs_running_lease_idx        rows=2
CTE over_quota: HashAggregate usage_ledger rows=20000, 1 lần    2,34 ms   (không hạn mức: never executed)
Limit → LockRows → Incremental Sort → Merge Append
  nhánh chương rảnh: Limit 33 ← Incremental Sort (priority, created_at | ord, id)
      Index Scan jobs_claim_idx on jobs        rows=41, bỏ 78 dòng của chương bận ở đầu hàng
      Index Scan pages_pkey                    loops=41
  nhánh chương bận:  Limit 33 ← Sort
      Bitmap Heap Scan jobs qua jobs_chapter_idx, 2 chương, 78 dòng
  Index Scan jobs_pkey (khoá)                  ≤ 66 dòng
```

- Nhánh chương rảnh đi theo `jobs_claim_idx` đúng thứ tự và dừng sớm ở mọi ô, kể cả ô ngoài ma trận (bỏ qua 1.998 dòng
  của chương bận ở đầu hàng rồi dừng).
- Không hạn mức thì CTE `over_quota` không được tính (`never executed`).
- Phần chênh +0,5 ms so với câu cũ khi không hạn mức: khoảng một nửa là lập kế hoạch (0,8–1,3 ms so với 0,5 ms của câu
  cũ, câu dài hơn), còn lại là nhánh chương bận và bước khoá.

### Đánh đổi của cách hai nhánh

Mỗi nhánh đọc trước `max + 32` dòng (`CLAIM_LOOKAHEAD`). Nếu chừng đó dòng đầu của cả hai nhánh đều đang bị transaction
khác khoá thì lượt claim trả rỗng dù phía sau còn job; worker nghỉ một nhịp backoff rồi claim lại. Với worker thật
(`max = 1`) cần hơn 33 lượt claim đang mở cùng lúc.

## Lượt đo 1 (bản xếp cả hàng đợi, commit `38e4f38`): dữ liệu

| Bảng | Số dòng |
|---|---|
| `jobs` queued, priority 100, `page.prepare` gọi LLM, payload có 2 slot `llm` | 5.998 (150 chương × 40 trang, mỗi chương một `created_at`) |
| `jobs` running, lease còn hạn | 2 (2 chương cũ nhất đang chờ) |
| `jobs` succeeded | 30.000 (750 chương cũ) |
| `pages` | 96.000 |
| `user` | 20 |
| `usage_ledger` hôm nay | 20.000 (1.000 dòng / user, tổng $10 / user) + 50 dòng nền tảng `user_id` NULL |

Cỡ self-host: cùng DB, huỷ job chờ của 148 chương → còn 78 queued + 2 running (2 chương).

Cấu hình:
- Hạn mức: `system_settings.user_daily_usd` = NULL (không hạn mức) hoặc 1000 (có hạn mức, chưa ai vượt → bộ lọc phải
  xét mọi job).
- Breaker bật: một provider đang pause, khác provider của các job → `jsonb_each` chạy cho từng job, không loại job nào.
- Token `mac` và `modal`.

## Lượt đo 1: cách đo

- SQL lấy từ `.toSQL()` của Drizzle, tham số thay bằng hằng. "Sau" là `pickClaimable()` trong
  `apps/api/src/jobs/queue.ts`. "Trước" là câu ở commit `ef1e70c` (thứ tự FIFO + bộ lọc hạn mức tương quan).
  "Giữa" = thứ tự mới + bộ lọc hạn mức cũ.
- Mỗi ô: làm nóng 1 lần, rồi 5 vòng xen kẽ trước / giữa / sau trong cùng một phiên `psql`, `\timing`, mỗi câu trong
  `BEGIN … ROLLBACK`, `LIMIT 1`. Số ghi là trung vị thời gian thật.
- Nhiễu của máy đo khoảng ±3 ms ở cỡ 6.000 job. Đo lại 15 vòng (cột "lần 2") để xem độ ổn định.

## Lượt đo 1: kết quả, 6.000 job chờ (ngưỡng cũ 15 ms)

Thời gian thật, ms, trung vị.

| Hạn mức | Token | Breaker | Trước | Giữa | Sau (5 vòng) | Sau (lần 2, 15 vòng: trung vị, min–max) | Đạt |
|---|---|---|---|---|---|---|---|
| không | mac | tắt | 0,30 | 137 | 10,5 | 8,5 (8,0–11,0) | có |
| không | mac | bật | 0,37 | 155 | 13,8 | 11,9 (11,4–12,7) | có |
| không | modal | tắt | 0,25 | 135 | 9,9 | 7,8 (7,5–9,2) | có |
| không | modal | bật | 0,35 | 153 | 13,3 | 10,8 (10,6–11,6) | có |
| có | mac | tắt | 4,28 | 672 | 12,9 | 10,9 (10,1–12,8) | có |
| có | mac | bật | 4,37 | 690 | **16,1** | **18,7** (16,5–37,5) | **không** |
| có | modal | tắt | 4,30 | 656 | 12,3 | 12,0 (11,2–14,4) | có |
| có | modal | bật | 4,39 | 716 | **15,9** | 14,2 (13,1–16,0) | **sát / không** |

Cột "Giữa" lớn cả khi không đặt hạn mức: Postgres không bỏ qua subquery tương quan dù hạn mức là NULL, nên với ledger
có dữ liệu nó vẫn cộng lại cho từng job.

## Lượt đo 1: kết quả, 78 job chờ (ngưỡng cũ 1 ms)

| Hạn mức | Token | Breaker | Trước | Giữa | Sau | Đạt |
|---|---|---|---|---|---|---|
| không | mac | tắt | 0,15 | 0,22 | 0,22 | có |
| không | mac | bật | 0,20 | 0,28 | 0,30 | có |
| không | modal | tắt | 0,14 | 0,21 | 0,21 | có |
| không | modal | bật | 0,19 | 0,28 | 0,27 | có |
| có | mac | tắt | 4,03 | 7,93 | **2,25** | **không** (nhanh hơn câu cũ) |
| có | mac | bật | 4,32 | 8,26 | **2,56** | **không** (nhanh hơn câu cũ) |
| có | modal | tắt | 4,02 | 7,80 | **2,24** | **không** (nhanh hơn câu cũ) |
| có | modal | bật | 4,10 | 7,99 | **2,31** | **không** (nhanh hơn câu cũ) |

## Lượt đo 1: ô vượt ngưỡng

### 1. 6.000 job chờ, có hạn mức và breaker bật: 14–19 ms

`EXPLAIN (ANALYZE, BUFFERS)` của ô modal (19,5 ms khi có đo đạc, 3.645 buffer), các bước chính:

```
Limit → LockRows → Sort (quicksort 618kB, 5.998 dòng)                       ~1,5 ms
  Nested Loop Left Join busy (2 dòng, đọc qua jobs_running_lease_idx)        ~0,9 ms
    Nested Loop Anti Join "user" (tài khoản bị khoá)                         ~0,4 ms
      Hash Right Join pages.id = jobs.page_id                                ~10 ms
        Seq Scan on pages (96.000 dòng, 2.910 buffer)                        7,2 ms
        Bitmap Heap Scan on jobs qua jobs_claim_idx (5.998 dòng)             6,5 ms
          SubPlan hạn mức: HashAggregate usage_ledger (20.000 dòng, 1 lần)   2,4 ms
          SubPlan breaker: jsonb_each, loops=5998
```

- Phần nặng nhất là ghép `pages` để lấy `ord` (quét cả bảng `pages`), rồi mới tới hai bộ lọc.
- Không có bước nào chạy lại theo từng dòng ngoài `jsonb_each` của breaker.
- Breaker chỉ bật 2 phút mỗi lần một provider lỗi liên tục, nên ô này là trạng thái tạm thời, không phải thường trực.

### 2. ≤ 100 job chờ, có hạn mức: 2,2–2,6 ms

Toàn bộ thời gian là một lần cộng ledger hôm nay của mọi user (`HashAggregate`, 20.000 dòng, 2,4 ms). Chi phí này cố
định theo số dòng ledger trong ngày, không theo số job. Câu cũ ở cùng ô mất 4,0–4,3 ms. Self-host không đặt hạn mức
nên không gặp ô này; chỉ bản nhiều người dùng gặp.

## Lượt đo 1: thử nhanh một dạng câu khác (không đưa vào code)

Thay `LEFT JOIN pages` bằng subquery vô hướng trong `ORDER BY` (`(select ord from pages where id = jobs.page_id)`):
ô modal + hạn mức + breaker còn 12,7 ms (so với 16,0 ms cùng phiên), ô mac không rõ khác biệt vì nhiễu
(18,0 so với 18,8 ms). Chưa đủ số liệu để kết luận.

## Kiểm validator hạn mức

Hạn mức âm không vào được hệ thống: env `USER_DAILY_USD` qua `z.coerce.number().nonnegative()` (`apps/api/src/env.ts:10`),
admin qua `z.number().finite().min(0)` (`apps/api/src/routes/admin-settings.ts:56`). Nhánh `limit <= 0` của bộ lọc mới
vì vậy chỉ gặp giá trị 0, và vẫn giữ nghĩa cũ nếu có số âm ghi thẳng vào DB.

## Test

- `pnpm --filter @mtl/api test` trước mọi thay đổi: 57 file, 529 qua, 1 bỏ qua (có từ trước). Ở HEAD: 543 qua, 1 bỏ qua.
- 14 ca mới: 11 ca thứ tự claim và 2 ca đọc plan trong `queue.test.ts`, 1 ca ledger `user_id` NULL trong
  `user-quota.test.ts`.
- Hai ca đọc plan: 1 user, 3.000 job đã xong + 75 chương × 40 job chờ, 2 chương cũ nhất đang bận, bật mọi bộ lọc theo
  dòng; đọc `EXPLAIN (ANALYZE, FORMAT JSON)` của `pickClaimableSql`. Một ca analyze sau khi lô job vào, một ca analyze
  trước (thống kê cũ). Cả hai đòi: đúng một Index Scan trên `jobs_claim_idx` đọc dưới 208 dòng (tính cả dòng bị bộ lọc
  loại), và tổng số dòng mọi nút đọc từ `jobs` dưới 750. Xanh cả khi chạy riêng (DB test vừa tạo) lẫn trong cả bộ. Để
  lộ lại `status` cho planner ở nhánh chương bận + tầng khoá thì cả hai ca đỏ.
- Ca nhóm hoà: chương 264 job cùng `created_at`, chèn ngược thứ tự trang → claim vẫn trả trang 0 rồi trang 1. Thay
  `with ties` bằng `limit` thì ca này đỏ 3/3 lần.
- **Không phải sửa kỳ vọng của test nào**, kể cả khi đổi sang câu hai nhánh. Test export-trước-backlog và test 1.000
  job giữ nguyên.
- Ba ca thêm cho câu hai nhánh: (a) kết nối thứ hai giữ khoá 3 dòng đầu hàng → claim trả dòng kế, cả khi chương rảnh
  lẫn khi chương đã bận; (b) chương bận có nhiều job chờ hơn số dòng đọc trước đứng đầu hàng → chương rảnh phía sau
  vẫn được chọn trước; (c) mọi chương chờ đều bận → chương ít job chạy hơn đi trước, dù chương kia tạo trước và có
  nhiều job chờ hơn số dòng đọc trước.
- Đã thử làm hỏng code để xem test có bắt được không:
  - bản xếp cả hàng đợi: bỏ khoá xếp "số job đang chạy" → 4 ca đỏ; bỏ điều kiện lease còn hạn → 1 ca đỏ; chỉ đếm job
    `page.prepare` → 1 ca đỏ; bỏ `user_id is not null` trong bộ lọc hạn mức → ca ledger NULL đỏ;
  - bản hai nhánh: số dòng đọc trước = 0 → ca (a) đỏ; bỏ `chapter_id is null or` → ca job không gắn chương đỏ; nhánh
    chương rảnh không lọc chương bận → 6 ca đỏ; tắt nhánh chương bận → 12 ca đỏ; nhánh chương bận không xếp theo số
    job chạy → ca (c) đỏ; tầng ngoài không kiểm lại `status` → ca 4 luồng claim trên 6 chương đỏ (trùng job), 2/2 lần.

## Smoke 2 worker, tiến trình native (ở commit `38e4f38`, trước khi đổi sang câu hai nhánh)

**Đã chạy, đạt.** Không dùng image Docker: API + jobs runner chạy native ở chế độ local (`MTL_LOCAL_MODE=1`, storage
disk) trên cổng riêng, DB riêng `mtl_smoke_fairshare` và thư mục dữ liệu tạm; 2 tiến trình `mtl-worker` thật
(`MTL_PROVIDER=anthropic`, `MTL_WORKERS=2`, cùng token) claim qua HTTP thật. Series tiếng Nhật nên xoá chữ + OCR chạy
local: 0 lần gọi LLM, chi phí $0 (`usage_ledger` không có dòng LLM). DB, thư mục dữ liệu và tiến trình smoke đã dọn.

Hai chương cùng series, commit liền nhau, dừng ở bước xoá chữ: chương 1 có 12 trang, chương 2 có 3 trang. Job
`page.prepare` của chương 2 được tạo trước chương 1 khoảng 0,1 s (ingest chương 2 xong trước). Mọi job `attempts = 1`.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | smoke-w2 | 07:01:21.338 |
| 2 | 1 | 0 | smoke-w1 | 07:01:21.466 |
| 3 | 2 | 1 | smoke-w2 | 07:01:24.329 |
| 4 | 1 | 1 | smoke-w1 | 07:01:24.699 |
| 5 | 2 | 2 | smoke-w2 | 07:01:26.867 |
| 6 | 1 | 2 | smoke-w1 | 07:01:27.220 |
| 7–15 | 1 | 3–11 | hai worker xen kẽ | 07:01:29.362 … 07:01:39.555 |

- Hai chương chồng thời gian ngay từ job đầu: chương 1 bắt đầu ở lượt 2 khi chương 2 (tạo job trước) còn 2 trang chờ.
  Với thứ tự cũ, cả hai worker sẽ làm hết 3 trang của chương 2 rồi mới tới chương 1.
- Mỗi worker giữ một chương cho tới khi chương ngắn hết trang, rồi cả hai cùng làm chương dài. Trang trong từng chương
  đúng thứ tự.
- Tiêu chí của plan (`claimed_at` đầu của chương ngắn sớm hơn trang thứ 3 từ cuối của chương dài): 07:01:21.338 <
  07:01:36.804. Tiêu chí này ở lần chạy này không tự nó phân biệt được code cũ và mới vì chương ngắn lại là chương có
  job tạo trước; bằng chứng phân biệt là lượt 2 ở trên.
- Giới hạn: không chạy bằng image Docker / compose, nên không kiểm phần đóng gói (đã có `infra/selfhost-smoke.sh`).
  Lần chạy đầu, log của jobs runner có 26 dòng chứa "error" mà tôi xoá mất trước khi đọc; chạy lại runner trên DB mới
  (khởi động sau khi API migrate xong, theo dõi 2 nhịp reaper) thì không có dòng lỗi nào. Nhiều khả năng lần đầu runner
  khởi động trước khi migrate xong, nhưng đó là suy đoán.

## Review code

- Commit `6c29f78`, `38e4f38`: không có phát hiện mức cao hay trung bình. Hai điểm thấp đã xử lý bằng chú thích trong
  `user-quota.ts` (cột user truyền vào phải NOT NULL; nói đúng phạm vi ảnh hưởng khi thiếu `user_id is not null`).
- Commit `1ea755e`: không có lỗi đúng / sai. Reviewer so thứ tự với bản một câu qua 1.850 lượt dữ liệu ngẫu nhiên (0 lệch),
  thử tầng khoá bằng 2 phiên (job bị claim / dời `run_after` / huỷ / xoá giữa chừng đều bị bỏ qua đúng; bỏ điều kiện
  kiểm lại thì hai worker nhận cùng job), kiểm `pgrowlocks` (chỉ khoá đúng dòng trả về). Một phát hiện mức trung bình có
  số đo: nhóm hoà 1.000 job của chương rảnh bị đẩy lên tầng khoá (1,73 ms so với 1,03 ms của bản trước). Đã sửa ở
  `3734f37` đúng theo cách reviewer đã thử và so 750 lượt (0 lệch); tôi đo lại cả ma trận. Commit `3734f37` không qua
  thêm vòng review riêng.
- Commit `547ac28`: ngữ nghĩa của `notDisabledOwnerSql` và `opaque()` đúng. Một phát hiện mức cao: thống kê `jobs` cũ làm
  nhánh chương bận và tầng khoá quét cả `jobs_claim_idx` (19 ms ở 6.000 job chờ, 59–114 ms ở 20.000). Đã sửa ở `1ea755e`.
  Ba điểm thấp về ca test đọc plan (đếm dòng qua bộ lọc thay vì dòng đã đọc; nuốt mọi lỗi; không có trạng thái thống
  kê cũ) cũng đã sửa ở `1ea755e`.
- Commit `0ba6998`: không có lỗi đúng / sai. Reviewer so thứ tự với bản một câu trên 1.800 lượt dữ liệu ngẫu nhiên (0
  lần lệch), kiểm khoá dòng bằng `pgrowlocks` (chỉ khoá đúng các dòng trả về), thử tranh chấp bằng 2 phiên. Một phát
  hiện mức trung bình có số đo: `cand` không `materialized` nên mỗi lần Postgres kiểm lại một dòng vừa bị transaction
  khác sửa, cả hai nhánh chạy lại (≈ 3,5 ms mỗi lần đụng nhau trên dữ liệu 2 chương bận × 1.000 job). Đã sửa ở
  `8256523` và đo lại cả ma trận.

## Smoke bằng image Docker (câu hai nhánh)

**Đã chạy trên commit `3734f37` (HEAD code cuối), đạt.** `SMOKE OK` sau 67 s. Trên chính stack đó, 2 worker trong container,
chương 12 trang (job tạo trước 0,1 s) và chương 3 trang: lượt claim 1 là trang 0 chương dài, lượt 2 là trang 0 chương
ngắn (FIFO cũ sẽ là trang 1 chương dài); hai worker mỗi người một chương tới hết chương ngắn (lượt 6), rồi cùng làm
chương dài. 15/15 job xong, `attempts = 1`, chi phí $0, log không lỗi, stack đã dọn.

Lần chạy ở commit `1ea755e`: **đạt.** `infra/selfhost-smoke.sh` (`SMOKE_KEEP=1`, cổng 18090): `SMOKE OK` sau 66 s, image
build từ working tree ở commit đó. DB của stack là self-host thật (1 user). Trên chính stack đó, 2 worker trong
container, commit chương 12 trang và chương 3 trang (job chương 3 trang tạo trước 0,17 s): 15/15 job xong,
`attempts = 1`, chi phí $0, log không có lỗi. Stack và thư mục tạm đã dọn.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | e1bd… | 08:31:39.912 |
| 2 | 1 | 0 | 7bce… | 08:31:40.083 |
| 3 | 2 | 1 | e1bd… | 08:31:43.750 |
| 4 | 1 | 1 | 7bce… | 08:31:44.230 |
| 5 | 2 | 2 | e1bd… | 08:31:46.537 |
| 6 | 1 | 2 | 7bce… | 08:31:46.835 |
| 7–15 | 1 | 3–11 | hai worker xen kẽ | 08:31:49.383 … 08:31:59.850 |

Lần chạy ở commit `547ac28`: **đạt.** `infra/selfhost-smoke.sh` (`SMOKE_KEEP=1`, cổng 18090): `SMOKE OK` sau 66 s; image
app có `opaque()` và bộ lọc tài khoản dạng `not in`. DB của stack là self-host thật (1 user). Trên chính stack đó, 2
worker trong container, commit chương 12 trang và chương 3 trang (job chương 3 trang tạo trước 0,14 s): 15/15 job xong,
`attempts = 1`, chi phí $0, log không có lỗi. Stack và thư mục tạm đã dọn.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | 6030… | 08:08:36.951 |
| 2 | 1 | 0 | 46df… | 08:08:37.095 |
| 3 | 2 | 1 | 6030… | 08:08:40.509 |
| 4 | 1 | 1 | 46df… | 08:08:40.646 |
| 5 | 2 | 2 | 6030… | 08:08:42.952 |
| 6 | 1 | 2 | 46df… | 08:08:43.235 |
| 7–15 | 1 | 3–11 | hai worker xen kẽ | 08:08:45.450 … 08:08:54.988 |

Các lượt chạy trước (giữ làm lịch sử):


**Đã chạy trên code cuối (commit `8256523`), đạt.** `infra/selfhost-smoke.sh` (`SMOKE_KEEP=1`, cổng 18090, model nạp
từ `worker/models`): `SMOKE OK` sau 66 s; image app có `cand as materialized`. Trên chính stack đó, 2 worker trong
container, commit 2 chương dừng ở bước xoá chữ (chương 1: 12 trang; chương 2: 3 trang, job tạo trước 0,15 s). 15/15 job
xong, mọi job `attempts = 1`, chi phí $0, log app / jobs / worker không có dòng lỗi. Stack và thư mục tạm đã dọn.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | 1ded… | 07:44:39.542 |
| 2 | 1 | 0 | d61a… | 07:44:39.705 |
| 3 | 2 | 1 | 1ded… | 07:44:42.858 |
| 4 | 1 | 1 | d61a… | 07:44:43.316 |
| 5 | 2 | 2 | 1ded… | 07:44:45.469 |
| 6 | 1 | 2 | d61a… | 07:44:45.794 |
| 7–15 | 1 | 3–11 | hai worker xen kẽ | 07:44:47.918 … 07:44:57.613 |

Mỗi worker giữ một chương cho tới khi chương ngắn hết trang; chương 1 bắt đầu ở lượt 2 khi chương 2 (tạo job trước)
còn 2 trang chờ. Với thứ tự FIFO cũ, lượt 2 sẽ là trang 1 của chương 2.

Lần chạy đầu, ở commit `0ba6998`: **đạt.** `infra/selfhost-smoke.sh` trên working tree ở commit `0ba6998` (`SMOKE_KEEP=1`, cổng 18090, model
nạp từ `worker/models`): build 2 image, `docker compose` với project `mtl-smoke` trong thư mục tạm, kết thúc bằng
`SMOKE OK` sau 71 s (SPA, upload, `page.prepare`, export, OCR thật, down/up giữ dữ liệu, backup khi khởi động lại, cổng
+ quyền file). Image app có code mới (`CLAIM_LOOKAHEAD` trong `src/jobs/queue.ts` của container). Không gọi LLM, chi phí
$0, không cần API key. Stack, thư mục tạm và dữ liệu đã dọn; không đụng dữ liệu dev.

Trên chính stack đó (2 worker trong container, `threads=6` mỗi worker), commit thêm 2 chương dừng ở bước xoá chữ:
chương 1 có 12 trang, chương 2 có 3 trang. Job của chương 2 được tạo trước 0,17 s. Mọi job `attempts = 1`, 15/15 xong.

| Lượt claim | Chương | Trang | Worker | `claimed_at` (UTC) |
|---|---|---|---|---|
| 1 | 2 | 0 | cb9c… | 07:27:13.826 |
| 2 | 1 | 0 | 68ca… | 07:27:13.998 |
| 3 | 2 | 1 | cb9c… | 07:27:18.195 |
| 4 | 2 | 2 | 68ca… | 07:27:18.202 |
| 5–15 | 1 | 1–11 | hai worker xen kẽ | 07:27:20.976 … 07:27:34.439 |

- Hai chương chồng thời gian từ job đầu: chương 1 bắt đầu ở lượt 2 khi chương 2 (tạo job trước) còn 2 trang chờ. Với
  thứ tự FIFO cũ, lượt 2 sẽ là trang 1 của chương 2.
- Lượt 3 và 4 cách nhau 7 ms và cùng vào chương 2: đây là trường hợp hai claim trùng thời điểm đã nêu ở quyết định 3
  (transaction claim của worker kia chưa commit nên chưa được đếm). Worker thứ hai bỏ qua dòng đang khoá và lấy trang kế
  của chương 2; không trùng job, lệch đúng một lượt, sau đó chỉ còn chương 1.
- Log của app, jobs và worker không có dòng lỗi nào.
- Giới hạn: lượt chạy này không phân biệt được bản xếp cả hàng đợi với bản hai nhánh (cùng thứ tự); nó xác nhận image
  build từ HEAD chạy đúng thứ tự chia lượt với 2 worker trong container.
