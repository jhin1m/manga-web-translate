/**
 * Điều kiện SQL "job gọi LLM" — khớp `isLlmPayload` (@mtl/shared): loại LLM trừ `page.prepare` OCR local
 * (`payload.pipeline.ocr_engine` là engine local). Breaker và kill-switch ngân sách chỉ chặn tập này; job OCR local
 * không tốn token nên vẫn chạy khi LLM tạm dừng hay vượt ngân sách.
 */
import { jobs } from "@mtl/db";
import { LLM_JOB_TYPES, LOCAL_OCR_ENGINES } from "@mtl/shared";
import { inArray, type SQL, sql } from "drizzle-orm";

const list = (xs: readonly string[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

export const llmJobSql: SQL = sql`(${inArray(jobs.type, [...LLM_JOB_TYPES])} and not (${jobs.type} = 'page.prepare' and coalesce(${jobs.payload} #>> '{pipeline,ocr_engine}', 'llm') in (${list(LOCAL_OCR_ENGINES)})))`;
