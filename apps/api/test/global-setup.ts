import { resetTestDatabase, testDatabaseUrl } from "@mtl/db/testing";

export default async function setup() {
  await resetTestDatabase(testDatabaseUrl("api"));
}
