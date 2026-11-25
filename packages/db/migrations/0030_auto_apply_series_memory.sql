ALTER TABLE "glossary_entries" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "style_origin" text;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_origin_chk" CHECK ("glossary_entries"."origin" in ('user', 'ai'));--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_style_origin_chk" CHECK ("series"."style_origin" in ('user', 'ai'));--> statement-breakpoint
-- Sổ khoá AI đã gặp: khoá thêm tiền tố cặp ngôn ngữ của series ("{src}>{tgt}|{key}", xem ledgerKey). Mọi dòng cũ,
-- kể cả gợi ý chưa duyệt, giữ lại làm khoá đã gặp nên AI không ghi lại các mục đó.
-- `NOT LIKE '%|%'` chỉ để chạy lại không cộng tiền tố hai lần. Rủi ro đã biết: khoá cũ có sẵn ký tự `|` (tên nguồn
-- chứa `|`) sẽ không được thêm tiền tố, nên không khớp khoá mới và AI có thể ghi lại mục đó một lần. Hiếm, chấp nhận.
UPDATE "series_suggestions" s SET "key" = ser."source_lang" || '>' || ser."target_lang" || '|' || s."key" FROM "series" ser WHERE ser."id" = s."series_id" AND s."key" NOT LIKE '%|%';
