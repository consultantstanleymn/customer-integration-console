import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { computeRowHash, type AuditFields } from "./audit-chain.js";

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
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(4242)");
      const last = await client.query(
        "SELECT row_hash FROM audit_log WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1",
      );
      const prevHash: string = last.rows.length > 0 ? (last.rows[0].row_hash as string) : "";
      const at = new Date();
      const fields: AuditFields = {
        at: at.toISOString(),
        actor: e.actor,
        role: e.role ?? null,
        action: e.action,
        target: e.target ?? null,
        outcome: e.outcome ?? "ok",
        detail: e.detail ?? {},
      };
      const rowHash = computeRowHash(prevHash, fields);
      await client.query(
        "INSERT INTO audit_log (at, actor, role, action, target, outcome, detail, prev_hash, row_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [at, fields.actor, fields.role, fields.action, fields.target, fields.outcome, JSON.stringify(fields.detail), prevHash, rowHash],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "audit write failed", err: String(err) }));
  }
}
