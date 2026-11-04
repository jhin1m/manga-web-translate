/** Mã hoá key provider: roundtrip, AAD gắn dòng, phát hiện sửa blob, khoá đọc mỗi lần gọi, parse env. */
import { describe, expect, it } from "vitest";
import { env, parseEnv } from "../src/env.ts";
import { decryptSecret, encryptSecret, SecretsError } from "../src/lib/secrets.ts";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");
const ID = "0194f6a0-0000-7000-8000-000000000001";
const OTHER = "0194f6a0-0000-7000-8000-000000000002";
const PLAIN = "sk-test-roundtrip-1234";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SecretsError ? e.code : `other:${String(e)}`;
  }
  return "no-throw";
};

const tamper = (blob: string, at: number) => {
  const raw = Buffer.from(blob, "base64");
  raw[at] = (raw[at] ?? 0) ^ 0xff;
  return raw.toString("base64");
};

describe("secrets", () => {
  it("roundtrips; blob never contains the plaintext; each call uses a fresh iv", () => {
    const a = encryptSecret(PLAIN, ID);
    expect(a).not.toContain(PLAIN);
    expect(Buffer.from(a, "base64").toString("latin1")).not.toContain(PLAIN);
    expect(decryptSecret(a, ID)).toBe(PLAIN);
    expect(encryptSecret(PLAIN, ID)).not.toBe(a);
  });

  it("a blob moved to another provider row does not decrypt (AAD)", () => {
    expect(code(() => decryptSecret(encryptSecret(PLAIN, ID), OTHER))).toBe("decrypt_failed");
  });

  it("a flipped byte in iv, tag or ciphertext fails", () => {
    const blob = encryptSecret(PLAIN, ID);
    for (const at of [1, 13, 29, 30]) expect(code(() => decryptSecret(tamper(blob, at), ID))).toBe("decrypt_failed");
  });

  it("short blob → malformed; version other than 1 → unsupported_version", () => {
    expect(code(() => decryptSecret(Buffer.alloc(10).toString("base64"), ID))).toBe("malformed");
    expect(code(() => decryptSecret(tamper(encryptSecret(PLAIN, ID), 0), ID))).toBe("unsupported_version");
  });

  it("the master key is read on every call (not memoised)", () => {
    const blob = encryptSecret(PLAIN, ID);
    env.SECRETS_KEY = KEY_B;
    expect(code(() => decryptSecret(blob, ID))).toBe("decrypt_failed");
    env.SECRETS_KEY = KEY_A;
    expect(decryptSecret(blob, ID)).toBe(PLAIN);
    env.SECRETS_KEY = undefined;
    expect(code(() => encryptSecret(PLAIN, ID))).toBe("secrets_key_missing");
  });

  it("errors carry only a code, never the blob or plaintext", () => {
    const blob = encryptSecret(PLAIN, ID);
    try {
      decryptSecret(tamper(blob, 30), ID);
    } catch (e) {
      expect(String((e as Error).message)).toBe("decrypt_failed");
      expect(JSON.stringify(e)).not.toContain(PLAIN);
    }
  });
});

describe("SECRETS_KEY env", () => {
  const { SECRETS_KEY: _k, NODE_ENV: _n, SIGNUP_ENABLED: _s, ...base } = process.env;

  it("optional; empty = unset", () => {
    expect(parseEnv(base).SECRETS_KEY).toBeUndefined();
    expect(parseEnv({ ...base, SECRETS_KEY: "" }).SECRETS_KEY).toBeUndefined();
    expect(parseEnv({ ...base, SECRETS_KEY: KEY_A }).SECRETS_KEY).toBe(KEY_A);
  });

  it("rejects 31 bytes, non-base64 and wrong length", () => {
    const k31 = `${Buffer.alloc(31, 1).toString("base64")}`; // 44 ký tự nhưng không đúng dạng 43 + "="
    expect(() => parseEnv({ ...base, SECRETS_KEY: k31 })).toThrow(/SECRETS_KEY/);
    expect(() => parseEnv({ ...base, SECRETS_KEY: `${"!".repeat(43)}=` })).toThrow(/SECRETS_KEY/);
    expect(() => parseEnv({ ...base, SECRETS_KEY: "short" })).toThrow(/SECRETS_KEY/);
  });
});
