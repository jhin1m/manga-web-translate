import { describe, expect, it } from "vitest";
import {
  deriveFilesKey,
  type FileSigParams,
  signFileUrl,
  verifyFileSig,
} from "../../src/storage-drivers/file-signing.ts";

const k = deriveFilesKey("s".repeat(32));
const now = 1_800_000_000;
const p: FileSigParams = { method: "POST", key: "u/a/ch/b/src/c.png", exp: now + 60, ct: "image/png", max: 1024 };

describe("file signing", () => {
  it("verifies its own signature", () => {
    expect(verifyFileSig(p, signFileUrl(p, k), k, now)).toBe(true);
  });

  it("any changed field or another key → false", () => {
    const sig = signFileUrl(p, k);
    const variants: FileSigParams[] = [
      { ...p, method: "PUT" },
      { ...p, key: "u/a/ch/b/src/d.png" },
      { ...p, exp: p.exp + 1 },
      { ...p, ct: "text/html" },
      { ...p, max: 1025 },
      { ...p, tag: "a=b" },
      { ...p, cd: "attachment" },
    ];
    for (const v of variants) expect(verifyFileSig(v, sig, k, now), JSON.stringify(v)).toBe(false);
    expect(verifyFileSig(p, sig, deriveFilesKey("t".repeat(32)), now)).toBe(false);
  });

  it("one flipped hex char → false", () => {
    const sig = signFileUrl(p, k);
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifyFileSig(p, flipped, k, now)).toBe(false);
  });

  it("expired or non-integer exp → false", () => {
    expect(verifyFileSig({ ...p, exp: now }, signFileUrl({ ...p, exp: now }, k), k, now)).toBe(false);
    const nan = { ...p, exp: Number.NaN };
    expect(verifyFileSig(nan, signFileUrl(nan, k), k, now)).toBe(false);
  });

  it("refuses to sign a field containing a newline (no shifting content between fields)", () => {
    expect(() => signFileUrl({ ...p, ct: "image/png\n999999999" }, k)).toThrow(RangeError);
    expect(() => signFileUrl({ ...p, cd: "a\nb" }, k)).toThrow(RangeError);
    expect(verifyFileSig({ ...p, cd: "\n" }, signFileUrl(p, k), k, now)).toBe(false);
  });

  it("wrong-length or non-hex signature → false without throwing", () => {
    expect(verifyFileSig(p, "", k, now)).toBe(false);
    expect(verifyFileSig(p, "abcd", k, now)).toBe(false);
    expect(verifyFileSig(p, `${signFileUrl(p, k)}00`, k, now)).toBe(false);
    expect(verifyFileSig(p, "z".repeat(64), k, now)).toBe(false);
  });
});
