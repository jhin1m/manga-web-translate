# Docs v0.4.0 report

## Files changed
- `README.md`: thêm mục "Thả folder, lưới bìa" vào Tính năng.
- `docs/releases/v0.4.0.md` (mới): tính năng, cách cập nhật (curl.exe, mỗi lệnh một dòng), giới hạn, kỹ thuật. Đầu file đánh dấu chưa phát hành.
- `docs/project-roadmap.md`: mục "Thumbnail do server sinh" đánh [x]; thêm mục "Phải làm" cho các bước phát hành còn lại (build 2 arch, rc, smoke, Windows, tag); thêm giới hạn đã biết của 0.4.0.
- `docs/design-guidelines.md`: Home / Series từ hàng một dòng sang lưới thẻ; thêm ghi chú cập nhật 16/11 (giữ nguyên câu "dark mode ngoài phạm vi").
- `docs/self-host.md`: không đổi (không có biến / hướng dẫn mới; không có số RAM đo cho thumbnail).

## Verified against code
sharp trong `apps/api/package.json`; migration 0029; endpoint thumbs/cover; bìa PNG/JPG/WebP ≤ 10 MB; MAX_FILES 400; thông báo "Không có ảnh nào trong folder."; trường Tên chương trong popover; thẻ chương có Ch.N + tên; sharp concurrency 2, giới hạn 100M điểm ảnh; không đổi worker từ v0.3.0.

## Unverifiable / chú ý
- Safari iOS không có folder picker: lấy từ yêu cầu, không kiểm.
- "Folder > 400 file thì app báo, không tạo chương": suy từ `files.ts` (problems), chưa đọc đường đi đầy đủ.
- Hiển thị "ảnh hiện dần ở lần xem đầu": suy từ thiết kế on-demand, chưa quan sát.
- RAM app khi tạo nhiều thumbnail chưa đo (phase 4 bước 3) nên không ghi số; nêu trong roadmap là chưa đo.
- Câu "Cập nhật ngay" trong release note chỉ đúng sau khi phát hành.
