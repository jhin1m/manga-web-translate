import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { apiError, apiErrorResponse, codeError } from "../../src/lib/api-error.ts";

const body = async (e: HTTPException) => {
  const res = e.getResponse();
  return { status: res.status, json: await res.json() };
};

describe("api error helpers", () => {
  it("apiError carries the stable code, the Vietnamese fallback message and the params", async () => {
    expect(await body(apiError(400, "trim_too_large", { min: 64 }))).toEqual({
      status: 400,
      json: { error: "trim_too_large", message: "phải chừa lại ít nhất 64px", params: { min: 64 } },
    });
  });

  it("a variant keeps `error` stable and adds `variant`; extra fields ride along", async () => {
    expect(await body(apiError(409, "in_use.font", {}, { series: ["A"] }))).toEqual({
      status: 409,
      json: {
        error: "in_use",
        variant: "font",
        message: "font đang là mặc định của series",
        params: {},
        series: ["A"],
      },
    });
  });

  it("extra fields can't overwrite the coded fields", async () => {
    const res = apiErrorResponse(413, "too_large.cover", { max_mb: 10 }, { error: "x", message: "y" });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_large", variant: "cover", message: "ảnh bìa tối đa 10 MB" });
  });

  it("codeError keeps the code-only body", async () => {
    expect(await body(codeError(403, "forbidden"))).toEqual({ status: 403, json: { error: "forbidden" } });
    expect(await body(codeError(400, "invalid_csv", { errors: [] }))).toEqual({
      status: 400,
      json: { error: "invalid_csv", errors: [] },
    });
  });

  it("is a real HTTPException", () => {
    expect(apiError(409, "last_page")).toBeInstanceOf(HTTPException);
  });
});
