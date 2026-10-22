/**
 * Bảng nghiệp vụ. Mọi bảng có workspace_id (FK organization, cascade); quan hệ cha-con dùng FK kép
 * (workspace_id, parent_id) → bản ghi con không thể trỏ sang cha của workspace khác, kể cả khi code sai.
 * Mọi truy vấn từ route đi qua `scoped(db, wsId)` (xem ../scoped.ts).
 */
import {
  ACTIVE_JOB_STATUSES,
  CHAPTER_STATUSES,
  ERROR_CLASSES,
  JOB_STATUSES,
  JOB_TYPES,
  type JobPayload,
  type JobResult,
  type OcrResult,
  PAGE_FORMATS,
  PAGE_STATUSES,
  type PageFormat,
  type PageState,
  type PreparePartial,
  SOURCE_SKIP_REASONS,
  type SourceSkipReason,
  USAGE_KINDS,
} from "@mtl/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth.ts";
import { idPk, inList, timestamps } from "./columns.ts";
import { dispatches } from "./dispatches.ts";

type ChapterStatus = (typeof CHAPTER_STATUSES)[number];
type PageStatus = (typeof PAGE_STATUSES)[number];
type UsageKind = (typeof USAGE_KINDS)[number];

const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    workerMode: text("worker_mode").$type<"mac" | "modal">().notNull().default("mac"),
    ...timestamps,
  },
  (t) => [check("workspace_settings_worker_mode_chk", inList(sql`${t.workerMode}`, ["mac", "modal"]))],
);

export const series = pgTable(
  "series",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    title: text("title").notNull(),
    sourceLang: text("source_lang").notNull().default("ko"),
    targetLang: text("target_lang").notNull().default("vi"),
    honorificPolicy: text("honorific_policy").notNull().default("translate"),
    pronounRules: jsonb("pronoun_rules").$type<Record<string, unknown>[]>().notNull().default([]),
    stylePrompt: text("style_prompt").notNull().default(""),
    defaultFonts: jsonb("default_fonts").$type<Record<string, string>>().notNull().default({}),
    llmTier: text("llm_tier").notNull().default("default"),
    /** Cách commit chương: strip (manhwa/manhua) hoặc pages (manga) — xem PAGE_FORMATS. */
    pageFormat: text("page_format").$type<PageFormat>().notNull().default("strip"),
    /** Tăng khi sửa glossary của series (sửa entry cấp workspace → tăng mọi series cùng transaction). */
    glossaryRev: integer("glossary_rev").notNull().default(0),
    /** Tăng khi đổi cài đặt ảnh hưởng dịch/typeset. */
    settingsRev: integer("settings_rev").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("series_ws_id_uq").on(t.workspaceId, t.id),
    index("series_ws_idx").on(t.workspaceId),
    check("series_page_format_chk", inList(sql`${t.pageFormat}`, PAGE_FORMATS)),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    seriesId: uuid("series_id").notNull(),
    number: numeric("number").notNull(),
    title: text("title").notNull().default(""),
    status: text("status").$type<ChapterStatus>().notNull().default("draft"),
    ingestRev: integer("ingest_rev").notNull().default(0),
    /** Mode của lần commit gần nhất (series.page_format lúc đó) — thứ tự đọc của page.prepare suy từ đây. */
    ingestMode: text("ingest_mode").$type<PageFormat>().notNull().default("strip"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("chapters_ws_id_uq").on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.seriesId], foreignColumns: [series.workspaceId, series.id] }).onDelete(
      "cascade",
    ),
    index("chapters_series_idx").on(t.seriesId),
    check("chapters_status_chk", inList(sql`${t.status}`, CHAPTER_STATUSES)),
    check("chapters_ingest_mode_chk", inList(sql`${t.ingestMode}`, PAGE_FORMATS)),
  ],
);

export const sourceFiles = pgTable(
  "source_files",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    chapterId: uuid("chapter_id").notNull(),
    ord: integer("ord").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    mime: text("mime").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Bỏ qua khi commit/ingest (null = dùng). Giữ hàng để hoàn tác và để tải tiếp khớp đúng bộ file. */
    skip: text("skip").$type<SourceSkipReason>(),
    /** dHash 16 hex trình duyệt tính lúc thả ảnh (null = không tính được) — khớp/học ảnh credit của series. */
    dhash: text("dhash"),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId, t.chapterId], foreignColumns: [chapters.workspaceId, chapters.id] }).onDelete(
      "cascade",
    ),
    index("source_files_chapter_idx").on(t.chapterId, t.ord),
    check("source_files_skip_chk", inList(sql`${t.skip}`, SOURCE_SKIP_REASONS)),
  ],
);

/**
 * Ảnh credit series đã học ("Luôn bỏ ở series này"): chương mới có ảnh khớp (dHash + tỉ lệ khung) bị bỏ qua sẵn
 * (`source_files.skip = 'credit'`). `thumb_key` là bản sao riêng → còn xem được khi chương nguồn bị xoá.
 */
export const seriesSkipImages = pgTable(
  "series_skip_images",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    seriesId: uuid("series_id").notNull(),
    dhash: text("dhash").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    thumbKey: text("thumb_key").notNull(),
    /** Chương học ra ảnh — chỉ để tra cứu, không FK (xoá chương vẫn giữ ảnh đã học). */
    learnedFromChapterId: uuid("learned_from_chapter_id"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId, t.seriesId], foreignColumns: [series.workspaceId, series.id] }).onDelete(
      "cascade",
    ),
    index("series_skip_images_series_idx").on(t.seriesId),
  ],
);

export const pages = pgTable(
  "pages",
  {
    /** Tất định: uuid v5(chapter_id, "{ingest_rev}:{ord}") — xem pageId() ở @mtl/shared. Không có default. */
    id: uuid("id").primaryKey(),
    workspaceId: workspaceId(),
    chapterId: uuid("chapter_id").notNull(),
    ord: integer("ord").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    originalKey: text("original_key").notNull(),
    originalSha256: text("original_sha256").notNull(),
    /** Con trỏ rev thắng của ảnh sạch/mask; next_rev cấp rev mới cho mỗi attempt (key không bao giờ ghi đè). */
    cleanRev: integer("clean_rev"),
    maskRev: integer("mask_rev"),
    nextRev: integer("next_rev").notNull().default(1),
    ocrResult: jsonb("ocr_result").$type<OcrResult>(),
    prepareInputRev: text("prepare_input_rev"),
    /** Artifact trước LLM của attempt lỗi provider (+ input_rev lúc đó) — lần prepare sau bỏ qua detect/inpaint. */
    preparePartial: jsonb("prepare_partial").$type<PreparePartial & { input_rev: string }>(),
    sourceMap: jsonb("source_map").$type<unknown[]>().notNull().default([]),
    cutFlag: boolean("cut_flag").notNull().default(false),
    /** Người dùng xoá (ẩn) trang: không dịch, không tính trạng thái chương, không xuất — khôi phục được. */
    skipped: boolean("skipped").notNull().default(false),
    status: text("status").$type<PageStatus>().notNull().default("pending"),
    ...timestamps,
  },
  (t) => [
    unique("pages_ws_id_uq").on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.chapterId], foreignColumns: [chapters.workspaceId, chapters.id] }).onDelete(
      "cascade",
    ),
    index("pages_chapter_idx").on(t.chapterId, t.ord),
    check("pages_status_chk", inList(sql`${t.status}`, PAGE_STATUSES)),
  ],
);

export const pageStates = pgTable(
  "page_states",
  {
    pageId: uuid("page_id").primaryKey(),
    workspaceId: workspaceId(),
    /** Không bao giờ reset — mọi lần ghi (AI hay người) +1. */
    version: bigint("version", { mode: "number" }).notNull().default(0),
    state: jsonb("state").$type<PageState>(),
    aiState: jsonb("ai_state").$type<PageState>(),
    aiRev: integer("ai_rev").notNull().default(0),
    stateOrigin: text("state_origin").$type<"ai" | "user">().notNull().default("ai"),
    aiUpdateAvailable: boolean("ai_update_available").notNull().default(false),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId, t.pageId], foreignColumns: [pages.workspaceId, pages.id] }).onDelete(
      "cascade",
    ),
    check("page_states_origin_chk", inList(sql`${t.stateOrigin}`, ["ai", "user"])),
  ],
);

export const pageStateHistory = pgTable(
  "page_state_history",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    pageId: uuid("page_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    state: jsonb("state").$type<PageState>(),
    /** `user:<id>` | `job:<id>` */
    actor: text("actor").notNull(),
    /** Gom các bản ghi của cùng một thao tác hàng loạt (find/replace, áp glossary) để hoàn tác. */
    batchId: uuid("batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId, t.pageId], foreignColumns: [pages.workspaceId, pages.id] }).onDelete(
      "cascade",
    ),
    index("page_state_history_page_idx").on(t.pageId, t.version),
    index("page_state_history_batch_idx").on(t.batchId).where(sql`${t.batchId} is not null`),
  ],
);

export const glossaryEntries = pgTable(
  "glossary_entries",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    /** null = áp cho toàn workspace. */
    seriesId: uuid("series_id"),
    /** Chỉ entry chung (series_id null) mang cặp nguồn→đích; entry series theo cặp của series (API đảm bảo). */
    sourceLang: text("source_lang"),
    targetLang: text("target_lang"),
    sourceTerm: text("source_term").notNull(),
    targetTerm: text("target_term").notNull(),
    note: text("note").notNull().default(""),
    caseSensitive: boolean("case_sensitive").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.workspaceId, t.seriesId], foreignColumns: [series.workspaceId, series.id] }).onDelete(
      "cascade",
    ),
    index("glossary_ws_series_idx").on(t.workspaceId, t.seriesId),
    // Một term mỗi phạm vi (series, hoặc cặp ngôn ngữ của workspace khi series_id null) — chặn tạo trùng khi
    // request đua nhau.
    unique("glossary_entries_scope_term_uq")
      .on(t.workspaceId, t.seriesId, t.sourceLang, t.targetLang, t.sourceTerm)
      .nullsNotDistinct(),
  ],
);

export const workerTokens = pgTable(
  "worker_tokens",
  {
    id: idPk(),
    name: text("name").notNull(),
    /** sha256 của token; token gốc chỉ hiện một lần lúc tạo. */
    tokenHash: text("token_hash").notNull().unique(),
    /** null = worker nền tảng (Modal), nhận job mọi workspace có worker_mode='modal'. */
    workspaceId: uuid("workspace_id").references(() => organization.id, { onDelete: "cascade" }),
    capabilities: text("capabilities").array().notNull().default(sql`'{}'::text[]`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("worker_tokens_ws_idx").on(t.workspaceId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: idPk(),
    workspaceId: workspaceId(),
    type: text("type").$type<(typeof JOB_TYPES)[number]>().notNull(),
    status: text("status").$type<(typeof JOB_STATUSES)[number]>().notNull().default("queued"),
    priority: integer("priority").notNull().default(100),
    payload: jsonb("payload").$type<JobPayload>().notNull(),
    result: jsonb("result").$type<JobResult>(),
    inputRev: text("input_rev").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Lỗi provider/rate-limit không tính vào attempts, đếm riêng. */
    providerRetries: integer("provider_retries").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    /** = worker_tokens.id của worker giữ lease (fencing). */
    leaseOwner: uuid("lease_owner").references(() => workerTokens.id, { onDelete: "set null" }),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /** Lúc claim attempt hiện tại — trần gpu_s khi clamp usage. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** worker_id tự khai của worker giữ lease (chỉ để hiển thị/log; fencing dùng lease_owner). */
    workerId: text("worker_id"),
    /** Rev output cấp lúc claim từ pages.next_rev (clean/mask); mỗi attempt một rev riêng. */
    outputRev: integer("output_rev"),
    progress: real("progress").notNull().default(0),
    stage: text("stage"),
    errorClass: text("error_class").$type<(typeof ERROR_CLASSES)[number]>(),
    error: text("error"),
    pipelineVersion: text("pipeline_version"),
    chapterId: uuid("chapter_id"),
    pageId: uuid("page_id"),
    /** Dispatch Modal của lần claim gần nhất (null = worker Mac / worker không qua dispatcher). */
    dispatchId: uuid("dispatch_id").references(() => dispatches.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // Chỉ job đang hoạt động mới unique theo key: job cũ failed/succeeded không chặn tạo lại.
    uniqueIndex("jobs_idempotency_active_uq")
      .on(t.idempotencyKey)
      .where(inList(sql`${t.status}`, ACTIVE_JOB_STATUSES)),
    index("jobs_claim_idx").on(t.priority, t.createdAt).where(sql`${t.status} = 'queued'`),
    index("jobs_ws_idx").on(t.workspaceId, t.createdAt),
    index("jobs_chapter_idx").on(t.chapterId),
    index("jobs_page_idx").on(t.pageId),
    index("jobs_lease_owner_idx").on(t.leaseOwner),
    // Reaper quét lease hết hạn.
    index("jobs_running_lease_idx").on(t.leaseExpiresAt).where(sql`${t.status} = 'running'`),
    foreignKey({ columns: [t.workspaceId, t.chapterId], foreignColumns: [chapters.workspaceId, chapters.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [t.workspaceId, t.pageId], foreignColumns: [pages.workspaceId, pages.id] }).onDelete(
      "cascade",
    ),
    check("jobs_type_chk", inList(sql`${t.type}`, JOB_TYPES)),
    check("jobs_status_chk", inList(sql`${t.status}`, JOB_STATUSES)),
    check("jobs_error_class_chk", sql`${t.errorClass} is null or ${inList(sql`${t.errorClass}`, ERROR_CLASSES)}`),
  ],
);

/**
 * Append-only. workspace_id null = chi phí nền tảng (VD GPU rỗi). Giá tính ở server từ số đếm thô.
 * Khử trùng: dòng theo job → unique (job_id, attempt, seq, kind); dòng nền tảng theo dispatch (job_id null) →
 * unique (dispatch_id, kind) — sessions/end gửi lại hoặc reaper ước lượng sau đó không ghi lần 2.
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: idPk(),
    workspaceId: uuid("workspace_id").references(() => organization.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    dispatchId: uuid("dispatch_id").references(() => dispatches.id, { onDelete: "restrict" }),
    attempt: integer("attempt").notNull().default(0),
    seq: integer("seq").notNull().default(0),
    kind: text("kind").$type<UsageKind>().notNull(),
    quantity: numeric("quantity", { mode: "number" }).notNull(),
    unitCostUsd: numeric("unit_cost_usd", { mode: "number" }).notNull(),
    costUsd: numeric("cost_usd", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("usage_ledger_job_attempt_seq_kind_uq").on(t.jobId, t.attempt, t.seq, t.kind),
    uniqueIndex("usage_ledger_dispatch_kind_uq").on(t.dispatchId, t.kind).where(sql`${t.dispatchId} is not null`),
    index("usage_ledger_ws_created_idx").on(t.workspaceId, t.createdAt),
    // Kill-switch ngân sách cộng cost_usd toàn cục theo ngày/tháng.
    index("usage_ledger_created_idx").on(t.createdAt),
    check("usage_ledger_kind_chk", inList(sql`${t.kind}`, USAGE_KINDS)),
  ],
);
