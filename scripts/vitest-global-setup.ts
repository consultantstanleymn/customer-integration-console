// Gives tests a Postgres: uses TEST_DATABASE_URL (CI service) or starts a local throw-away one.
// @ts-expect-error plain .mjs helper without types
import { startLocalPostgres } from "./pg-local.mjs";

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) return;
  const pg = await startLocalPostgres();
  process.env.TEST_DATABASE_URL = pg.url;
  return () => pg.stop();
}
