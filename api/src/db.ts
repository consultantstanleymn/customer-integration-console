import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "migrations");
export const TRANSFORMS_DIR = join(here, "..", "sql", "transforms");

export type Db = pg.Pool;

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

/** Applies each migrations/*.sql file once, in name order. Safe to run many times. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

export type Outcome = "ok" | "denied" | "error";

/** Writes one audit row. Never throws into the request path. */
export async function audit(
  db: Db,
  e: { actor: string; role?: string | null; action: string; target?: string | null; outcome?: Outcome; detail?: unknown },
): Promise<void> {
  try {
    await db.query(
      "INSERT INTO audit_log (actor, role, action, target, outcome, detail) VALUES ($1,$2,$3,$4,$5,$6)",
      [e.actor, e.role ?? null, e.action, e.target ?? null, e.outcome ?? "ok", JSON.stringify(e.detail ?? {})],
    );
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "audit write failed", err: String(err) }));
  }
}
