import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_REPOS,
  compareVersions,
  composeUrl,
  isNewer,
  isPrerelease,
  parseVersion,
  releaseUrl,
  runnerName,
  UPDATE_REASONS,
  UPDATE_STEPS,
} from "../src/update.ts";

describe("parseVersion", () => {
  it.each(["v0.3.0", "0.3.0", "1.2.3-rc.1", "1.0.0-alpha-1"])("accepts %s", (v) => {
    expect(parseVersion(v)).not.toBeNull();
  });
  it.each(["0.3", "01.2.3", "1.2.3+b", "dev", "", "vv1.2.3", "1.2.3-", "1.2.3-01", "1.2.3-a..b"])("rejects %j", (v) => {
    expect(parseVersion(v)).toBeNull();
  });
  it("splits prerelease identifiers", () => {
    expect(parseVersion("v1.2.3-rc.2")).toEqual({ major: 1, minor: 2, patch: 3, pre: ["rc", "2"] });
  });
});

describe("compareVersions", () => {
  it.each([
    ["0.3.0-rc.1", "0.3.0"],
    ["0.3.0-rc.2", "0.3.0-rc.10"],
    ["0.3.0-alpha", "0.3.0-rc.1"],
    ["0.3.0-rc", "0.3.0-rc.1"],
    ["0.3.0-1", "0.3.0-a"],
    ["0.99.99", "1.0.0"],
    ["0.9.0", "0.10.0"],
    ["0.2.9", "0.2.10"],
  ])("%s < %s", (lo, hi) => {
    expect(compareVersions(lo, hi)).toBe(-1);
    expect(compareVersions(hi, lo)).toBe(1);
    expect(isNewer(hi, lo)).toBe(true);
    expect(isNewer(lo, hi)).toBe(false);
  });
  it("treats a leading v as equal", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(isNewer("1.2.3", "v1.2.3")).toBe(false);
  });
  it.each([
    ["dev", "0.3.0"],
    ["0.3.0", "dev"],
    ["junk", "0.3.0"],
    ["0.4.0", ""],
  ])("never newer or older with invalid input (%j vs %j)", (a, b) => {
    expect(compareVersions(a, b)).toBeNull();
    expect(isNewer(a, b)).toBe(false);
  });
});

describe("isPrerelease", () => {
  it("detects prerelease only on valid versions", () => {
    expect(isPrerelease("0.3.0-rc.1")).toBe(true);
    expect(isPrerelease("0.3.0")).toBe(false);
    expect(isPrerelease("dev")).toBe(false);
  });
});

describe("urls and names", () => {
  it("builds release and compose urls", () => {
    expect(releaseUrl("0.3.0")).toBe("https://github.com/jhin1m/manga-web-translate/releases/tag/v0.3.0");
    expect(composeUrl("v0.3.0")).toBe(
      "https://raw.githubusercontent.com/jhin1m/manga-web-translate/v0.3.0/docker-compose.yml",
    );
    expect(runnerName("mtl")).toBe("mtl-update");
  });
  it("lists allowed image repos", () => {
    expect(ALLOWED_IMAGE_REPOS).toContain("postgres");
  });
});

describe("reason and step lists", () => {
  it("have no duplicates", () => {
    expect(new Set(UPDATE_REASONS).size).toBe(UPDATE_REASONS.length);
    expect(new Set(UPDATE_STEPS).size).toBe(UPDATE_STEPS.length);
  });
});
