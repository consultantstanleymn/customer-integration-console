import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TRANSFORMS_DIR, type Db } from "../db.js";
import type { Metrics } from "../metrics.js";
import { qualityChecks, type QualityResult, type RawRow } from "../quality.js";
import { OrderIn, issuesOf } from "../schemas.js";

export type SourceRow = { id: number; name: string; type: "csv" | "rest" | "webhook"; config: Record<string, string>; watermark: string | null };
export type RunKind = "manual" | "upload" | "webhook" | "replay";
export type RunResult = { runId: number; status: "success" | "failed"; rowsIn: number; rowsLoaded: number; rowsFailed: number; watermarkAfter: string | null; quality: QualityResult[]; error?: string };

const STALE_MINUTES = 15;

function transforms(): { name: string; sql: string }[] {
  return readdirSync(TRANSFORMS_DIR).filter((f) => f.endsWith(".sql")).sort()
    .map((name) => ({ name, sql: readFileSync(join(TRANSFORMS_DIR, name), "utf8") }));
}

/** The later of two ISO timestamps (null means "none yet"). */
export const maxWatermark = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

export class RunConflict extends Error {}

/**
 * One pipeline run: validate -> stage -> SQL transform -> quality -> commit.
 * All database work after the run row is created happens in ONE transaction,
 * so a crash can never leave half a load or a watermark that moved without its data.
 */
export async function runPipeline(
  db: Db, source: SourceRow, rows: RawRow[],
  opts: { kind: RunKind; triggeredBy: string; webhookEventIds?: number[]; metrics?: Metrics },
): Promise<RunResult> {
  await db.query(
    "UPDATE runs SET status='failed', error='abandoned: no heartbeat', finished_at=now() WHERE source_id=$1 AND status='running' AND started_at < now() - ($2 || ' minutes')::interval",
    [source.id, String(STALE_MINUTES)],
  );
  if ((await db.query("SELECT 1 FROM runs WHERE source_id=$1 AND status='running'", [source.id])).rowCount) {
    throw new RunConflict("a run is already in progress for this source");
  }
  const started = Date.now();
  const fresh = (await db.query("SELECT watermark FROM sources WHERE id=$1", [source.id])).rows[0]?.watermark ?? null;
  const run = (await db.query(
    "INSERT INTO runs (source_id, kind, status, rows_in, watermark_before, triggered_by) VALUES ($1,$2,'running',$3,$4,$5) RETURNING id",
    [source.id, opts.kind, rows.length, fresh, opts.triggeredBy],
  )).rows[0].id as number;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // 1. validate: split into good and bad rows
    const good: ReturnType<typeof OrderIn.parse>[] = [];
    let failed = 0;
    for (const raw of rows) {
      const parsed = OrderIn.safeParse(raw);
      if (parsed.success) good.push(parsed.data);
      else {
        failed++;
        await client.query("INSERT INTO dead_letters (run_id, source_id, payload, errors) VALUES ($1,$2,$3,$4)", [run, source.id, JSON.stringify(raw), JSON.stringify(issuesOf(parsed.error))]);
      }
    }
    // 2. stage the good rows
    for (const g of good) {
      await client.query(
        "INSERT INTO stg_orders (run_id, source_id, external_id, customer_email, amount, currency, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [run, source.id, g.external_id, g.customer_email, g.amount, g.currency, g.status, g.updated_at],
      );
    }
    // 3. transform + load with the SQL files (01 takes the run id, the marts take nothing)
    let loaded = 0;
    for (const t of transforms()) {
      const res = await client.query(t.sql, t.name.startsWith("01_") ? [run] : []);
      if (t.name.startsWith("01_")) loaded = res.rowCount ?? 0;
    }
    await client.query("DELETE FROM stg_orders WHERE run_id=$1", [run]);
    // 4. quality checks on the raw batch, stored per run
    const quality = qualityChecks(rows, failed);
    for (const q of quality) await client.query("INSERT INTO quality_results (run_id, check_name, passed, detail) VALUES ($1,$2,$3,$4)", [run, q.name, q.passed, q.detail]);
    // 5. move the watermark only now, in the same transaction as the data
    const newest = good.reduce<string | null>((m, g) => maxWatermark(m, g.updated_at), null);
    const after = maxWatermark(fresh, newest);
    await client.query("UPDATE sources SET watermark=$2 WHERE id=$1", [source.id, after]);
    if (opts.webhookEventIds?.length) await client.query("UPDATE webhook_events SET processed_run_id=$1 WHERE id = ANY($2)", [run, opts.webhookEventIds]);
    await client.query("UPDATE runs SET status='success', rows_loaded=$2, rows_failed=$3, watermark_after=$4, finished_at=now() WHERE id=$1", [run, loaded, failed, after]);
    await client.query("COMMIT");
    record(opts.metrics, source, "success", loaded, failed, started);
    return { runId: run, status: "success", rowsIn: rows.length, rowsLoaded: loaded, rowsFailed: failed, watermarkAfter: after, quality };
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : String(e);
    await db.query("UPDATE runs SET status='failed', error=$2, rows_failed=$3, finished_at=now() WHERE id=$1", [run, msg, rows.length]);
    record(opts.metrics, source, "failed", 0, rows.length, started);
    return { runId: run, status: "failed", rowsIn: rows.length, rowsLoaded: 0, rowsFailed: rows.length, watermarkAfter: fresh, quality: [], error: msg };
  } finally {
    client.release();
  }
}

function record(m: Metrics | undefined, s: SourceRow, status: string, loaded: number, failed: number, started: number) {
  if (!m) return;
  m.runs.inc({ status, source_type: s.type });
  m.rows.inc({ result: "loaded" }, loaded);
  m.rows.inc({ result: "failed" }, failed);
  m.runSeconds.observe((Date.now() - started) / 1000);
}
