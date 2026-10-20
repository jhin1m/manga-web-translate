/**
 * Sinh JSON Schema (draft 2020-12) từ zod — nguồn duy nhất cho worker Python validate.
 * Chạy: pnpm schema:emit. File sinh ra được commit; test chặn lệch giữa zod và file đã commit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonSchemas } from "../src/json-schema.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "json-schema");
mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(buildJsonSchemas())) {
  writeFileSync(join(outDir, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote json-schema/${name}.schema.json`);
}
