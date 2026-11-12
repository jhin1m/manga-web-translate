import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api.ts";
import { type BandResult, bandSummary, failedBand, retryEdges } from "./band-learn-model.ts";

const api = (status: number, error?: string) => new ApiError(status, "x", error ? { error } : {});
const ok = (edge: "top" | "bottom", learned: number, known = 0): BandResult => ({ edge, ok: true, learned, known });

describe("failedBand", () => {
  it("retries network, decode, 5xx and not_uploaded only", () => {
    expect(failedBand("top", new TypeError("fetch")).ok).toBe(false);
    expect(failedBand("top", new TypeError("fetch"))).toMatchObject({ retry: true });
    expect(failedBand("top", api(503))).toMatchObject({ retry: true });
    expect(failedBand("top", api(409, "not_uploaded"))).toMatchObject({ retry: true });
  });
  it("does not retry terminal server verdicts", () => {
    for (const code of ["plain_image", "no_trim", "skip_images_full", "band_too_small", "trim_changed", "no_hash"]) {
      expect(failedBand("bottom", api(409, code))).toMatchObject({ retry: false });
    }
    expect(failedBand("bottom", api(404))).toMatchObject({ retry: false });
  });
});

describe("bandSummary", () => {
  it("keeps the plain wording when every edge succeeded", () => {
    expect(bandSummary([ok("top", 1), ok("bottom", 1)])).toEqual({
      tone: "info",
      text: "Đã học 2 dải — chương sau của series tự cắt dải giống.",
    });
    expect(bandSummary([ok("bottom", 0, 1)]).text).toBe("Đã có sẵn 1 dải này trong danh sách tự cắt của series.");
  });
  it("reports a mixed result per edge", () => {
    expect(bandSummary([failedBand("top", api(409, "plain_image")), ok("bottom", 1)])).toEqual({
      tone: "danger",
      text: "Đã học dải cuối; dải đầu: ảnh gần trơn.",
    });
    expect(bandSummary([ok("top", 0, 1), failedBand("bottom", api(409, "band_too_small"))]).text).toBe(
      "Dải đầu đã có sẵn; dải cuối: dải quá mỏng.",
    );
  });
});

describe("retryEdges", () => {
  it("lists only the retryable failed edges", () => {
    expect(retryEdges([failedBand("top", api(409, "plain_image")), failedBand("bottom", api(502))])).toEqual([
      "bottom",
    ]);
    expect(retryEdges([ok("top", 1), ok("bottom", 1)])).toEqual([]);
  });
});
