import { loadRootEnv } from "@mtl/db";
import { z } from "zod";

loadRootEnv();

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  API_PORT: z.coerce.number().int().default(8787),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  /** Domain file riêng trình duyệt thấy (dev: localhost:9100, prod: files.<domain>). */
  FILES_DOMAIN: z.string().min(1),
  FILES_SCHEME: z.enum(["http", "https"]).default("https"),
});
export type Env = z.infer<typeof Env>;

export const env: Env = Env.parse(process.env);
