import { z } from "zod";
import { ErrorClass, JobPayload, JobResult, JobType } from "./job.ts";
import { OcrResult, PageState, Region, TextBox } from "./page-state.ts";

/** Các schema xuất cho worker; tên = tên file `<name>.schema.json`. */
export const exportedSchemas = {
  "page-state": PageState,
  region: Region,
  "text-box": TextBox,
  "ocr-result": OcrResult,
  "job-type": JobType,
  "job-payload": JobPayload,
  "job-result": JobResult,
  "error-class": ErrorClass,
} as const;

export function buildJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(exportedSchemas).map(([name, schema]) => [
      name,
      { $id: `https://mtl.local/schema/${name}.json`, ...z.toJSONSchema(schema, { target: "draft-2020-12" }) },
    ]),
  );
}
