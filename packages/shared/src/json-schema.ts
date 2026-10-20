import { z } from "zod";
import { ErrorClass, JobPayload, JobResult, JobType, PreparePartial } from "./job.ts";
import { OcrResult, PageState, Region, TextBox } from "./page-state.ts";
import {
  ClaimResponse,
  ExportInputs,
  IngestInputs,
  OcrRegionInputs,
  PrepareInputs,
  PresignOutputsResponse,
  ReinpaintInputs,
  TranslateInputs,
  WorkerUsage,
} from "./worker-protocol.ts";

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
  "prepare-partial": PreparePartial,
  "worker-usage": WorkerUsage,
  "claim-response": ClaimResponse,
  "presign-outputs-response": PresignOutputsResponse,
  "inputs-chapter-ingest": IngestInputs,
  "inputs-page-prepare": PrepareInputs,
  "inputs-chapter-translate": TranslateInputs,
  "inputs-page-reinpaint": ReinpaintInputs,
  "inputs-page-ocr-region": OcrRegionInputs,
  "inputs-chapter-export": ExportInputs,
} as const;

export function buildJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(exportedSchemas).map(([name, schema]) => [
      name,
      { $id: `https://mtl.local/schema/${name}.json`, ...z.toJSONSchema(schema, { target: "draft-2020-12" }) },
    ]),
  );
}
