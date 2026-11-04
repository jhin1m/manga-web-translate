/**
 * Mã hoá key provider AI (AES-256-GCM, khoá chính `env.SECRETS_KEY`). Blob = base64(version 1B | iv 12B | tag 16B |
 * ciphertext); AAD `ai_provider:<id>` gắn blob với đúng dòng provider (tráo blob sang dòng khác không giải mã được).
 * Khoá đọc từ env mỗi lần gọi (không nhớ) để test đổi / xoá được; byte version chừa chỗ cho việc xoay khoá về sau.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.ts";

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

export class SecretsError extends Error {
  constructor(readonly code: "secrets_key_missing" | "unsupported_version" | "malformed" | "decrypt_failed") {
    super(code);
  }
}

const masterKey = (): Buffer => {
  if (!env.SECRETS_KEY) throw new SecretsError("secrets_key_missing");
  return Buffer.from(env.SECRETS_KEY, "base64");
};

const aad = (providerId: string) => Buffer.from(`ai_provider:${providerId}`);

export const secretsConfigured = (): boolean => !!env.SECRETS_KEY;

export function encryptSecret(plain: string, providerId: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aad(providerId));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** Lỗi chỉ mang mã (không mang blob / plaintext). */
export function decryptSecret(blob: string, providerId: string): string {
  const key = masterKey();
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 1 + IV_LEN + TAG_LEN + 1) throw new SecretsError("malformed");
  if (raw[0] !== VERSION) throw new SecretsError("unsupported_version");
  const iv = raw.subarray(1, 1 + IV_LEN);
  const tag = raw.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = raw.subarray(1 + IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(aad(providerId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretsError("decrypt_failed");
  }
}
