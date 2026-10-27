/**
 * Seed DB e2e (chạy trong package api: `pnpm --filter @mtl/api exec tsx <file>` với DATABASE_URL = DB e2e).
 * Import tương đối để dependency resolve theo package sở hữu file. In 1 dòng JSON cuối cho global-setup.
 */
import { resetTestDatabase } from "../../../packages/db/src/testing.ts";
import { E2E_OWNER } from "./env.ts";

const url = process.env.DATABASE_URL ?? "";
await resetTestDatabase(url);

const { scoped, series } = await import("../../../packages/db/src/index.ts");
const { closeDb, db } = await import("../../api/src/db.ts");
const { createUser } = await import("../../api/src/lib/create-user.ts");
const { createWorkerToken } = await import("../../api/src/lib/worker-token.ts");

const { email, password } = E2E_OWNER;
const { userId } = await createUser({ email, name: "Owner", password });
const s = await scoped(db, userId).insert(series, { title: "Series e2e", llmTier: "standard" });
const { token } = await createWorkerToken({ name: "e2e-fake-worker", kind: "mac", capabilities: [] });
await closeDb();
console.info(JSON.stringify({ userId, seriesId: s.id, email, password, token }));
