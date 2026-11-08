import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { audit, type Db } from "./db.js";
import type { Config } from "./config.js";
import type { Metrics } from "./metrics.js";
import { CreateSource, ReplayBody, OrderIn, issuesOf, type Role } from "./schemas.js";
import { extractCsv, extractRest, extractWebhook, verifySignature } from "./pipeline/extract.js";
import { runPipeline, RunConflict, type SourceRow } from "./pipeline/run.js";
import { qualityScore } from "./quality.js";
import { newToken } from "./auth.js";
import type { Session } from "./auth.js";

export type Deps = { db: Db; cfg: Config; metrics: Metrics };
export type Ctx = { req: FastifyRequest & { rawBody?: string; session?: Session }; reply: FastifyReply; body: unknown; query: Record<string, string>; params: Record<string, string> };

/** One entry per endpoint. The same table drives registration, RBAC and the OpenAPI document. */
export type RouteDef = {
  method: "GET" | "POST" | "DELETE";
  path: string;               // Fastify style: /sources/:id
  summary: string;
  auth: "public" | Role;      // minimum role
  body?: z.ZodType;
  rawText?: boolean;          // body is raw text (CSV upload)
  handler: (c: Ctx) => Promise<unknown>;
};

class HttpError extends Error { constructor(public status: number, msg: string, public extra?: unknown) { super(msg); } }
export { HttpError };

const maskConfig = (c: Record<string, string>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === "secret" || k === "apiKey" ? "********" : v]));
const idOf = (p: Record<string, string>) => { const n = Number(p.id); if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "id must be a positive integer"); return n; };

export function routes({ db, metrics }: Deps): RouteDef[] {
  const who = (c: Ctx) => c.req.session?.email ?? "system";

  async function sourceById(id: number): Promise<SourceRow> {
    const s = (await db.query("SELECT id, name, type, config, watermark FROM sources WHERE id=$1", [id])).rows[0];
    if (!s) throw new HttpError(404, "source not found");
    return s;
  }
  async function pendingGauge() {
    metrics.deadLettersPending.set(Number((await db.query("SELECT count(*) FROM dead_letters WHERE status='pending'")).rows[0].count));
  }
  async function finish(c: Ctx, action: string, source: SourceRow, result: Awaited<ReturnType<typeof runPipeline>>) {
    await audit(db, { actor: who(c), role: c.req.session?.role, action, target: `source:${source.id}`, outcome: result.status === "success" ? "ok" : "error", detail: { runId: result.runId, loaded: result.rowsLoaded, failed: result.rowsFailed } });
    await pendingGauge();
    return result;
  }
  const guard = async <T,>(fn: () => Promise<T>) => {
    try { return await fn(); } catch (e) { if (e instanceof RunConflict) throw new HttpError(409, e.message); throw e; }
  };

  return [
    { method: "GET", path: "/health", summary: "Liveness and database check", auth: "public", handler: async () => { await db.query("SELECT 1"); return { status: "ok" }; } },
    { method: "GET", path: "/me", summary: "Current user, role and CSRF token", auth: "viewer", handler: async (c) => { const s = c.req.session!; return { email: s.email, name: s.name, role: s.role, csrfToken: s.csrf }; } },

    {
      method: "GET", path: "/sources", summary: "List sources with health", auth: "viewer",
      handler: async () => {
        const { rows } = await db.query(`
          SELECT s.id, s.name, s.type, s.config, s.watermark, s.created_at,
                 (SELECT status FROM runs r WHERE r.source_id=s.id ORDER BY r.id DESC LIMIT 1) AS last_status,
                 (SELECT max(finished_at) FROM runs r WHERE r.source_id=s.id AND r.status='success') AS last_success_at,
                 (SELECT count(*)::int FROM dead_letters d WHERE d.source_id=s.id AND d.status='pending') AS pending_dead_letters,
                 (SELECT count(*)::int FROM webhook_events w WHERE w.source_id=s.id AND w.processed_run_id IS NULL) AS pending_events
          FROM sources s ORDER BY s.id`);
        return rows.map((r) => ({ ...r, config: maskConfig(r.config) }));
      },
    },
    {
      method: "POST", path: "/sources", summary: "Create a source", auth: "engineer", body: CreateSource,
      handler: async (c) => {
        const b = c.body as z.infer<typeof CreateSource>;
        const config: Record<string, string> = { ...(b.config as Record<string, string>) };
        let secret: string | undefined;
        if (b.type === "webhook") { secret = newToken(24); config.secret = secret; }
        try {
          const r = (await db.query("INSERT INTO sources (name, type, config, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [b.name, b.type, JSON.stringify(config), who(c)])).rows[0];
          await audit(db, { actor: who(c), role: c.req.session?.role, action: "source.create", target: `source:${r.id}`, detail: { name: b.name, type: b.type } });
          c.reply.code(201);
          return { id: r.id, name: b.name, type: b.type, webhookSecret: secret };
        } catch (e) {
          if ((e as { code?: string }).code === "23505") throw new HttpError(409, "a source with this name exists");
          throw e;
        }
      },
    },
    {
      method: "DELETE", path: "/sources/:id", summary: "Delete a source and its data", auth: "admin",
      handler: async (c) => {
        const id = idOf(c.params);
        const r = await db.query("DELETE FROM sources WHERE id=$1", [id]);
        if (!r.rowCount) throw new HttpError(404, "source not found");
        await audit(db, { actor: who(c), role: c.req.session?.role, action: "source.delete", target: `source:${id}` });
        await pendingGauge();
        return { deleted: id };
      },
    },
    {
      method: "POST", path: "/sources/:id/run", summary: "Run a REST or webhook source now", auth: "engineer",
      handler: async (c) => {
        const s = await sourceById(idOf(c.params));
        const result = await guard(async () => {
          if (s.type === "rest") return runPipeline(db, s, await extractRest({ baseUrl: s.config.baseUrl!, apiKey: s.config.apiKey }, s.watermark), { kind: "manual", triggeredBy: who(c), metrics });
          if (s.type === "webhook") { const w = await extractWebhook(db, s.id); return runPipeline(db, s, w.rows, { kind: "webhook", triggeredBy: who(c), webhookEventIds: w.eventIds, metrics }); }
          throw new HttpError(400, "csv sources load through /upload");
        });
        return finish(c, "pipeline.run", s, result);
      },
    },
    {
      method: "POST", path: "/sources/:id/upload", summary: "Upload a CSV file (text/csv body)", auth: "engineer", rawText: true,
      handler: async (c) => {
        const s = await sourceById(idOf(c.params));
        if (s.type !== "csv") throw new HttpError(400, "this source is not a csv source");
        let rows;
        try { rows = extractCsv(String(c.body ?? "")); } catch (e) { throw new HttpError(400, `cannot parse csv: ${(e as Error).message}`); }
        const result = await guard(() => runPipeline(db, s, rows, { kind: "upload", triggeredBy: who(c), metrics }));
        return finish(c, "csv.upload", s, result);
      },
    },
    {
      method: "POST", path: "/webhooks/:id", summary: "Receive a webhook (HMAC signed, no session)", auth: "public", rawText: true,
      handler: async (c) => {
        const s = await sourceById(idOf(c.params));
        if (s.type !== "webhook") throw new HttpError(404, "source not found");
        if (!verifySignature(s.config.secret ?? "", c.req.rawBody ?? "", c.req.headers["x-signature"] as string | undefined)) {
          await audit(db, { actor: "webhook", action: "webhook.reject", target: `source:${s.id}`, outcome: "denied" });
          metrics.authEvents.inc({ event: "webhook_bad_signature" });
          throw new HttpError(401, "bad signature");
        }
        let payload: unknown;
        try { payload = JSON.parse(c.req.rawBody ?? ""); } catch { throw new HttpError(400, "body must be JSON"); }
        await db.query("INSERT INTO webhook_events (source_id, payload) VALUES ($1,$2)", [s.id, JSON.stringify(payload)]);
        c.reply.code(202);
        return { accepted: true };
      },
    },

    {
      method: "GET", path: "/runs", summary: "Recent runs (?source_id, ?limit)", auth: "viewer",
      handler: async (c) => {
        const limit = Math.min(Number(c.query.limit ?? 25) || 25, 200);
        const sid = c.query.source_id ? Number(c.query.source_id) : null;
        const { rows } = await db.query(
          `SELECT r.*, s.name AS source_name FROM runs r JOIN sources s ON s.id=r.source_id WHERE ($1::int IS NULL OR r.source_id=$1) ORDER BY r.id DESC LIMIT $2`, [sid, limit]);
        return rows;
      },
    },
    {
      method: "GET", path: "/runs/:id", summary: "One run with its quality results", auth: "viewer",
      handler: async (c) => {
        const id = idOf(c.params);
        const run = (await db.query("SELECT r.*, s.name AS source_name FROM runs r JOIN sources s ON s.id=r.source_id WHERE r.id=$1", [id])).rows[0];
        if (!run) throw new HttpError(404, "run not found");
        const quality = (await db.query("SELECT check_name, passed, detail FROM quality_results WHERE run_id=$1 ORDER BY id", [id])).rows;
        return { ...run, quality };
      },
    },
    {
      method: "GET", path: "/stats", summary: "Dashboard numbers: throughput per day, quality scorecard, totals", auth: "viewer",
      handler: async () => {
        const throughput = (await db.query(`
          SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day, sum(rows_loaded)::int AS loaded, sum(rows_failed)::int AS failed, count(*)::int AS runs
          FROM runs WHERE started_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`)).rows;
        const latest = (await db.query(`
          SELECT DISTINCT ON (r.source_id) r.id AS run_id, r.source_id, s.name AS source_name
          FROM runs r JOIN sources s ON s.id=r.source_id WHERE r.status='success' ORDER BY r.source_id, r.id DESC`)).rows;
        const quality = [];
        for (const l of latest) {
          const checks = (await db.query("SELECT check_name, passed, detail FROM quality_results WHERE run_id=$1 ORDER BY id", [l.run_id])).rows;
          quality.push({ ...l, score: qualityScore(checks), checks });
        }
        const totals = (await db.query(`SELECT (SELECT count(*)::int FROM orders) AS orders,
          (SELECT count(*)::int FROM dead_letters WHERE status='pending') AS pending_dead_letters,
          (SELECT count(*)::int FROM runs WHERE status='failed') AS failed_runs,
          (SELECT count(*)::int FROM runs) AS runs`)).rows[0];
        return { throughput, quality, totals };
      },
    },

    {
      method: "GET", path: "/dead-letters", summary: "Rows that failed validation (?status)", auth: "viewer",
      handler: async (c) => {
        const status = ["pending", "replayed", "discarded"].includes(c.query.status ?? "") ? c.query.status : "pending";
        return (await db.query("SELECT d.*, s.name AS source_name FROM dead_letters d JOIN sources s ON s.id=d.source_id WHERE d.status=$1 ORDER BY d.id DESC LIMIT 200", [status])).rows;
      },
    },
    {
      method: "POST", path: "/dead-letters/:id/replay", summary: "Fix (optional) and replay a dead letter", auth: "engineer", body: ReplayBody,
      handler: async (c) => {
        const id = idOf(c.params);
        const d = (await db.query("SELECT * FROM dead_letters WHERE id=$1", [id])).rows[0];
        if (!d) throw new HttpError(404, "dead letter not found");
        if (d.status !== "pending") throw new HttpError(409, `already ${d.status}`);
        const payload = (c.body as z.infer<typeof ReplayBody>).payload ?? d.payload;
        const check = OrderIn.safeParse(payload);
        if (!check.success) throw new HttpError(422, "row is still invalid", { issues: issuesOf(check.error) });
        const s = await sourceById(d.source_id);
        const result = await guard(() => runPipeline(db, s, [payload as Record<string, unknown>], { kind: "replay", triggeredBy: who(c), metrics }));
        if (result.status === "success") await db.query("UPDATE dead_letters SET status='replayed', resolved_at=now() WHERE id=$1", [id]);
        await audit(db, { actor: who(c), role: c.req.session?.role, action: "deadletter.replay", target: `deadletter:${id}`, outcome: result.status === "success" ? "ok" : "error", detail: { runId: result.runId, edited: !!(c.body as z.infer<typeof ReplayBody>).payload } });
        await pendingGauge();
        return result;
      },
    },
    {
      method: "POST", path: "/dead-letters/:id/discard", summary: "Discard a dead letter", auth: "engineer",
      handler: async (c) => {
        const id = idOf(c.params);
        const r = await db.query("UPDATE dead_letters SET status='discarded', resolved_at=now() WHERE id=$1 AND status='pending'", [id]);
        if (!r.rowCount) throw new HttpError(404, "no pending dead letter with this id");
        await audit(db, { actor: who(c), role: c.req.session?.role, action: "deadletter.discard", target: `deadletter:${id}` });
        await pendingGauge();
        return { discarded: id };
      },
    },
    {
      method: "GET", path: "/audit", summary: "Audit log (admin only)", auth: "admin",
      handler: async (c) => {
        await audit(db, { actor: who(c), role: c.req.session?.role, action: "audit.view" });
        return (await db.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200")).rows;
      },
    },
  ];
}
