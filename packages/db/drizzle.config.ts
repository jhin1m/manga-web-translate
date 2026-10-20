import { defineConfig } from "drizzle-kit";
import { loadRootEnv } from "./src/env.ts";

loadRootEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
