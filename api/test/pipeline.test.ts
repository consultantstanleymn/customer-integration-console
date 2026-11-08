import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, CSV_HEADER, goodCsv } from "./helpers.js";
import { audit, migrate, type Db } from "../src/db.js";
import { extractCsv } from "../src/pipeline/extract.js";
import { runPipeline, RunConflict, type SourceRow } from "../src/pipeline/run.js";

let db: Db;
let src: SourceRow;

async function newSource(name: string, type: "csv" | "webhook" = "csv"): Promise<SourceRow> {
  const r = await db.query("INSERT INTO sources (name, type, created_by) VALUES ($1,$2,'test') RETURNING id, name, type, config, watermark", [name, type]);
  return r.rows[0];
}
const load = async (csv: string, s = src) => runPipeline(db, (await db.query("SELECT id,name,type,config,watermark FROM sources WHERE id=$1", [s.id])).rows[0], extractCsv(csv), { kind: "upload", triggeredBy: "test" });

beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.end(); });

describe("migrations", () => {
  it("are safe to run twice", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("pipeline", () => {
  it("loads good rows and normalises them in SQL", async () => {
    src = await newSource("csv-a");
    const r = await load(goodCsv);
    expect(r).toMatchObject({ status: "success", rowsIn: 3, rowsLoaded: 3, rowsFailed: 0 });
    const o = (await db.query("SELECT * FROM orders WHERE source_id=$1 AND external_id='A-1'", [src.id])).rows[0];
    expect(o).toMatchObject({ customer_email: "ann@example.com", amount_cents: "1050", currency: "USD", status: "paid" });
  });

  it("is idempotent: loading the same file twice gives the same table", async () => {
    const before = (await db.query("SELECT count(*)::int AS n, sum(amount_cents)::int AS s FROM orders WHERE source_id=$1", [src.id])).rows[0];
    await load(goodCsv);
    const after = (await db.query("SELECT count(*)::int AS n, sum(amount_cents)::int AS s FROM orders WHERE source_id=$1", [src.id])).rows[0];
    expect(after).toEqual(before);
  });

  it("moves the watermark to the newest loaded row", async () => {
    const s = (await db.query("SELECT watermark FROM sources WHERE id=$1", [src.id])).rows[0];
    expect(s.watermark).toBe("2026-02-03T10:00:00.000Z");
  });

  it("does not let an older version overwrite a newer one", async () => {
    await load(`${CSV_HEADER}\nA-1,ann@example.com,999,USD,paid,2026-01-01T00:00:00Z`);
    const o = (await db.query("SELECT amount_cents FROM orders WHERE source_id=$1 AND external_id='A-1'", [src.id])).rows[0];
    expect(o.amount_cents).toBe("1050");
  });

  it("updates a row when a newer version arrives", async () => {
    const r = await load(`${CSV_HEADER}\nA-1,ann@example.com,11,USD,refunded,2026-03-01T00:00:00Z`);
    expect(r.rowsLoaded).toBe(1);
    const o = (await db.query("SELECT amount_cents, status FROM orders WHERE source_id=$1 AND external_id='A-1'", [src.id])).rows[0];
    expect(o).toEqual({ amount_cents: "1100", status: "refunded" });
  });

  it("parks bad rows in the dead-letter table with reasons, and loads the rest", async () => {
    const s = await newSource("csv-bad");
    const r = await load(`${CSV_HEADER}\nB-1,ok@x.test,5,USD,paid,2026-02-01T00:00:00Z\nB-2,broken,5,USD,paid,2026-02-01T00:00:00Z\nB-3,ok@x.test,-4,USD,paid,2026-02-01T00:00:00Z`, s);
    expect(r).toMatchObject({ status: "success", rowsLoaded: 1, rowsFailed: 2 });
    const dl = (await db.query("SELECT payload, errors, status FROM dead_letters WHERE run_id=$1 ORDER BY id", [r.runId])).rows;
    expect(dl).toHaveLength(2);
    expect(dl[0].errors[0]).toContain("customer_email");
    expect(dl[0].status).toBe("pending");
  });

  it("stores quality results per run", async () => {
    const s = await newSource("csv-drift");
    const r = await load("external_id,customer_email,amount,currency,status,updated_at,discount\nD-1,a@b.co,1,USD,paid,2026-02-01T00:00:00Z,5\nD-1,a@b.co,1,USD,paid,2026-02-01T00:00:00Z,5", s);
    const q = (await db.query("SELECT check_name, passed FROM quality_results WHERE run_id=$1", [r.runId])).rows;
    expect(q).toHaveLength(4);
    expect(q.find((x) => x.check_name === "schema_drift").passed).toBe(false);
    expect(q.find((x) => x.check_name === "duplicate_keys").passed).toBe(false);
  });

  it("builds the SQL marts", async () => {
    const m = (await db.query("SELECT orders, revenue_cents FROM mart_daily_revenue WHERE source_id=$1 AND day='2026-02-02'", [src.id])).rows[0];
    expect(m).toEqual({ orders: "1", revenue_cents: "2000" });
    const c = (await db.query("SELECT orders, lifetime_cents FROM mart_customer_summary WHERE customer_email='ann@example.com'")).rows[0];
    expect(c.orders).toBe("2"); // A-1 and A-3 (A-3 is cancelled, so it is not in lifetime)
    expect(c.lifetime_cents).toBe("1100");
  });

  it("rolls everything back when the load fails: no data, no watermark move", async () => {
    const s = await newSource("csv-boom");
    await db.query("CREATE OR REPLACE FUNCTION boom() RETURNS trigger AS $$ BEGIN IF NEW.external_id='BOOM' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql");
    await db.query("CREATE TRIGGER boom_t BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION boom()");
    const r = await load(`${CSV_HEADER}\nOK-1,a@b.co,1,USD,paid,2026-02-01T00:00:00Z\nBOOM,a@b.co,1,USD,paid,2026-02-02T00:00:00Z`, s);
    await db.query("DROP TRIGGER boom_t ON orders");
    expect(r.status).toBe("failed");
    expect((await db.query("SELECT count(*)::int AS n FROM orders WHERE source_id=$1", [s.id])).rows[0].n).toBe(0);
    expect((await db.query("SELECT watermark FROM sources WHERE id=$1", [s.id])).rows[0].watermark).toBeNull();
    const run = (await db.query("SELECT status, error FROM runs WHERE id=$1", [r.runId])).rows[0];
    expect(run).toEqual({ status: "failed", error: "boom" });
  });

  it("refuses a second run while one is running", async () => {
    const s = await newSource("csv-busy");
    await db.query("INSERT INTO runs (source_id, status, triggered_by) VALUES ($1,'running','x')", [s.id]);
    await expect(runPipeline(db, s, [], { kind: "manual", triggeredBy: "t" })).rejects.toBeInstanceOf(RunConflict);
  });

  it("marks an abandoned run as failed and allows a new one", async () => {
    const s = await newSource("csv-stale");
    await db.query("INSERT INTO runs (source_id, status, triggered_by, started_at) VALUES ($1,'running','x', now() - interval '1 hour')", [s.id]);
    const r = await runPipeline(db, s, [], { kind: "manual", triggeredBy: "t" });
    expect(r.status).toBe("success");
    expect((await db.query("SELECT error FROM runs WHERE source_id=$1 AND status='failed'", [s.id])).rows[0].error).toContain("abandoned");
  });

  it("marks webhook events as processed", async () => {
    const s = await newSource("hook", "webhook");
    const ev = (await db.query("INSERT INTO webhook_events (source_id, payload) VALUES ($1,$2) RETURNING id", [s.id, JSON.stringify({ external_id: "W-1", customer_email: "w@x.test", amount: 3, currency: "USD", status: "paid", updated_at: "2026-02-01T00:00:00Z" })])).rows[0].id;
    const r = await runPipeline(db, s, [{ external_id: "W-1", customer_email: "w@x.test", amount: 3, currency: "USD", status: "paid", updated_at: "2026-02-01T00:00:00Z" }], { kind: "webhook", triggeredBy: "t", webhookEventIds: [ev] });
    expect(r.rowsLoaded).toBe(1);
    expect((await db.query("SELECT processed_run_id FROM webhook_events WHERE id=$1", [ev])).rows[0].processed_run_id).toBe(r.runId);
  });
});

describe("audit log", () => {
  it("accepts rows but refuses update and delete", async () => {
    await audit(db, { actor: "t", action: "test.event" });
    await expect(db.query("UPDATE audit_log SET actor='x'")).rejects.toThrow("append-only");
    await expect(db.query("DELETE FROM audit_log")).rejects.toThrow("append-only");
  });
});
