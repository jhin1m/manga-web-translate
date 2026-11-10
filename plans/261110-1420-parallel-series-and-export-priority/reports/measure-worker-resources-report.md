# Đo RAM / CPU worker self-host (phase 1)

Ngày đo: 2026-11-10. Image build local từ `main` (`be6eea7`), tag `dev`: `infra/docker/{app,worker}.Dockerfile`.
Stack: `docker-compose.yml` self-host trong thư mục riêng, `./data` trống, model chép sẵn vào `data/models` (sha256 khớp,
không tải lại).

## Môi trường

| Mục | Giá trị |
|---|---|
| Máy | Mac Apple Silicon, OrbStack (VM aarch64) |
| Nhân CPU trong VM (`docker run --rm alpine nproc`) | 12 |
| RAM VM Docker | 15,66 GiB |
| onnxruntime | 1.31.0 (CPU) |
| Provider dịch | Anthropic `claude-haiku-5-5` |

Cách đo: script đọc cgroup v2 trong từng container mỗi 0,5 s. `usage` = `memory.current − inactive_file`, cùng định nghĩa
với `docker stats`. `anon` = bộ nhớ ẩn danh, không gồm page cache. Mẫu RAM được ghép với khoảng `claimed_at → updated_at`
của từng job trong bảng `jobs`.

Dữ liệu (1 worker, chạy lần lượt):
- **Tall**: 1 trang 800×11827 (3 slice strip ghép dọc), nguồn `ko`, dạng từng trang, dịch.
- **Manga20**: 20 trang manga 954×1500, nguồn `ja`, dạng từng trang, dịch.
- **Strip41**: 41 slice 800×~4000, nguồn `ko`, dạng cuộn dọc. Ingest cắt ra 31 trang, cao TB 4518 px. Có dịch.
- Xuất `png_zip` cả 3 chương.

## RAM một worker

RAM worker tăng theo **bộ model đã nạp**. Model nạp lười ở job đầu tiên cần đến, và onnxruntime không trả arena về:

| Thời điểm | anon (MiB) |
|---|---|
| Vừa khởi động, `mode=loop`, chưa job nào | 589 |
| Sau `page.prepare` đầu (trang Tall, `ko`: detector + mask + LaMa + Paddle Hàn) | 3 325 |
| Sau `page.prepare` manga `ja` đầu tiên (nạp thêm manga-ocr) | 3 964 |
| `chapter.ingest` strip 41 slice (đỉnh) | 4 651 |
| Rảnh sau khi xong cả 3 chương + 3 lần xuất | 4 495 |

Đỉnh theo loại job (`usage` / `anon`, MiB). Vì RAM không giảm lại, đỉnh của job sau đã gồm phần job trước để lại:

| Job | n | `usage` đỉnh | `anon` đỉnh | Thời gian TB (s) | max (s) |
|---|---|---|---|---|---|
| `page.prepare` | 52 | 4 532 | 4 494 | 20,3 | 36,2 |
| `chapter.translate` | 19 | 4 531 | 4 494 | 8,3 | 12,2 |
| `chapter.ingest` | 3 | **4 687** | 4 651 | 30,6 | 89,0 (strip 41 slice) |
| `chapter.export` | 3 | 4 529 | 4 495 | 4,4 | 10,1 |

- `peak_worker` = **4 687 MiB** (ingest strip dài). Worker đã nạp đủ model của mọi ngôn ngữ thì nằm ở ~4,5 GB ngay cả khi rảnh.
- `base` (app + jobs + postgres, cộng theo từng giây lúc chạy) = **374 MiB**. Đỉnh riêng từng container: app 247, jobs 99,
  postgres 48 MiB.

## CPU và thời gian xoá chữ

| Cấu hình | Trang | Thời gian 1 job `page.prepare` (trung vị) | 20 trang xong sau |
|---|---|---|---|
| 1 worker, luồng mặc định (`threads=0`) | Manga20, 954×1500 | 27,2 s (TB 25,0 s) | 501 s (cộng thời gian job, không gồm dịch xen giữa) |
| 2 worker, mỗi worker luồng mặc định (tranh nhau 12 nhân) | Manga20-2w, cùng ảnh | 40,8 s (TB 38,1 s) | 395 s (đo từ lúc claim đầu tới lúc xong cuối) |

- 1 worker xoá chữ dùng TB **10,5 / 12 nhân**. Hai worker chạy cùng lúc thì mỗi worker còn ~5,5 nhân.
- 2 worker không chia luồng: mỗi trang chậm hơn ~1,5 lần, nhưng tổng thời gian cho 20 trang nhanh hơn ~1,27 lần. Lợi ích
  chính là chương khác không phải đợi. Số này để so với phần chia luồng (`MTL_THREADS = 12 / 2 = 6`) ở phase 3.
- Trang strip 800×4518: TB 16,8 s. Trang Tall 800×11827: 36,1 s.

## Hai worker cùng lúc (`--scale worker=2`)

- Không OOM: `memory.events` của cả hai container có `oom_kill 0`, `RestartCount 0`.
- Đỉnh cộng cả 5 container: **8 269 MiB**. Worker 2 chỉ chạy manga `ja` nên đỉnh 3 390 MiB. Worker 1 giữ 4 535 MiB từ lượt trước.

## RAM tối thiểu ghi vào docs

`peak_worker` = 4 687 MiB. `base` lấy số lớn nhất đã đo ở cả hai lượt: 669 MiB, ở lượt smoke 2 worker của phase 3, khi
app + jobs tăng lúc nhận upload 35 file cùng lúc.

| Số worker | Công thức | Kết quả | Ghi docs |
|---|---|---|---|
| 2 (mặc định) | 2 × 4 687 + 669 = 10 043 MiB ≈ 9,8 GiB | làm tròn lên | **≥ 10 GB** RAM cho Docker |
| 1 (`MTL_WORKERS=1`) | 4 687 + 669 = 5 356 MiB ≈ 5,2 GiB | làm tròn lên | **≥ 6 GB** |

Docs cũ ghi "RAM ≥ 4 GB" là thiếu, kể cả khi chỉ chạy 1 worker.

## Smoke phase 3: 2 worker chia luồng (image mới, `MTL_WORKERS=2` → `threads=6`)

3 chương commit liền nhau (`ja`, dạng từng trang, có dịch): Par1 5 trang, Par2 20 trang, Par3 10 trang. Cùng ảnh với Manga20.

- Log có 2 `worker_id` khác nhau (`2de0e9b375fb`, `9c7ebf7eb446`), mỗi worker `threads=6`. Chương nào cũng có job do cả 2
  worker chạy. Có 15 cặp job của 2 chương khác nhau chạy chồng thời gian, trên 2 worker khác nhau.
- Xuất ZIP Par1 lúc hàng đợi còn 26 `page.prepare` (priority 100) của Par2/Par3 và 2 job đang chạy. Job xuất có
  priority 10, chờ claim 9,5 s (worker xong trang đang làm), chạy 0,9 s. Từ lúc bấm tới khi tải được: 11,2 s.
- `page.prepare` 35 trang: trung vị **17,6 s** (TB 16,4 s), mỗi worker dùng TB 4,8 nhân. Xong cả 35 trang sau 356 s
  (~10,2 s/trang), so với ~25 s/trang khi chạy 1 worker 12 luồng và ~19,8 s/trang khi chạy 2 worker không chia luồng.
- RAM: mỗi worker đỉnh 3 442 MiB (chỉ `ja`). Đỉnh cộng cả 5 container: 7 298 MiB. Không OOM.
- Kiểm thêm compose: `MTL_WORKERS=1 up -d` → còn 1 worker `threads=auto`. Bỏ biến rồi `up -d` → lại 2 worker
  `threads=6`. Chạy `up -d` khi không đổi gì thì không tạo lại container. `restart worker` restart cả 2 bản sao.

Quan sát (ngoài phạm vi): trên máy này 1 worker 6 luồng xoá chữ nhanh hơn 1 worker 12 luồng (17,6 s so với 27,2 s/trang).
Có thể vì onnxruntime không tăng tốc thêm khi vượt số nhân hiệu năng cao. Chưa đổi mặc định cho `MTL_WORKERS=1`.

## Ghi chú / rủi ro

- Docker Desktop thường giới hạn RAM VM thấp hơn RAM máy. Docs đã nhắc chỗ chỉnh RAM (Settings → Resources) và cách
  chạy `MTL_WORKERS=1`.
- Số trên đo bằng aarch64/OrbStack. amd64 có thể khác một chút (khác bản build onnxruntime), nhưng không đổi quy mô GB.
- Không đo GPU (self-host chưa hỗ trợ).

## Câu hỏi còn mở

Không có. Không OOM nên không phải dừng; mặc định 2 worker giữ nguyên như đã chốt.
