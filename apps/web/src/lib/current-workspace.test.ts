import { describe, expect, it } from "vitest";
import { resolveCurrentWs } from "./current-workspace.ts";

const a = { id: "a" };
const b = { id: "b" };

describe("resolveCurrentWs", () => {
  it("has nothing to pick without workspaces", () => {
    expect(resolveCurrentWs([], "a")).toEqual({ none: true });
  });
  it("uses the only workspace, ignoring an unknown stored id", () => {
    expect(resolveCurrentWs([a], "zzz")).toEqual({ ws: "a" });
    expect(resolveCurrentWs([a], null)).toEqual({ ws: "a" });
  });
  it("uses a stored workspace that is still a membership", () => {
    expect(resolveCurrentWs([a, b], "b")).toEqual({ ws: "b" });
  });
  it("asks to pick among several when nothing valid is stored", () => {
    expect(resolveCurrentWs([a, b], null)).toEqual({ pick: true });
    expect(resolveCurrentWs([a, b], "gone")).toEqual({ pick: true });
  });
});
