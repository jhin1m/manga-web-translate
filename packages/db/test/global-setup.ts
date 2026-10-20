import { resetTestDatabase, testDatabaseUrl } from "../src/testing.ts";

export default async function setup() {
  await resetTestDatabase(testDatabaseUrl("db"));
}
