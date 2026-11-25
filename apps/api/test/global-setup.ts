import { rm } from "node:fs/promises";
import { resetTestDatabase, testDatabaseUrl } from "@mtl/db/testing";
import { TEST_FILES_DIR } from "./files-dir.ts";

export default async function setup() {
  await resetTestDatabase(testDatabaseUrl("api"));
  await rm(TEST_FILES_DIR, { recursive: true, force: true });
}
