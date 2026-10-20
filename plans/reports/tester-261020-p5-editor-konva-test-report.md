# Phase 5 editor — báo cáo kiểm thử (tester, 2026-10-20)

## Kết quả lệnh
| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | PASS (shared, db, web, api) |
| `pnpm lint` | PASS (153 file) |
| `pnpm test` | PASS 136/136 (shared 8, db 3, web 36, api 89) |
| `pnpm --filter @mtl/web e2e` ×2 | PASS 2/2 cả 2 lần (~16s), không flaky |
| `pnpm --filter @mtl/web build` | PASS; cảnh báo chunk chính 907 kB (gzip 281 kB) |

Coverage: chưa đo (`@vitest/coverage-v8` chưa cài).

## Đối chiếu success criteria
| # | Tiêu chí | Trạng thái |
|---|---|---|
| 1 | 800×12k/20k mở <2s, ≥50fps M1, Safari 18 | Không đo được local. Sau review: thêm unit test culling tile (`tiles.test.ts`) |
| 2 | Undo/redo 100 thao tác | Unit (`history.test.ts`, 120 thao tác) |
| 3 | Reinpaint ≤15s worker Mac | Một phần: API (enqueue, 409 rev cũ, 423, mask thiếu). Latency/worker thật chưa |
| 4 | 409 rebase, liệt kê xung đột | Unit (`save.test.ts`, `rebase.test.ts`) + API |
| 5 | Kill tab → khôi phục | e2e (`editor.spec.ts`) + unit (`pending-queue.test.ts`) |
| 6 | AI mới: giữ sửa tay, banner, áp từng vùng | Logic unit; UI panel chưa e2e |
| 7 | Dấu chồng tiếng Việt | Round-trip e2e + NFC unit; glyph soi bằng ảnh chụp thủ công; gate bbox ở Phase 6 |
| 8 | Owner làm xong chương KO 40 slice | Không kiểm local |

## Chưa có test
TileLayer render thật, MaskLayer/MaskPanel client, OcrSelect UI, heartbeat khoá riêng editor, phím tắt ngoài Ctrl+Z, `fonts.ts` với manifest thật.

## Câu hỏi mở
- Tiêu chí 1, 3 (latency), 8: kiểm thủ công trên Mac/Safari?
- Bundle 907 kB: tách chunk route editor?
- Ngưỡng coverage có bắt buộc không?
