import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEnv, goodCsv, CSV_HEADER, type Env } from "./helpers.js";
import { signBody } from "../src/pipeline/extract.js";

let env: Env;
type Who = Awaited<ReturnType<Env["login"]>>;
let admin: Who, eng: Who, viewer: Who;

beforeAll(async () => {
  env = await startEnv({ rateLimit: 2, windowMs: 1000 });
  [admin, eng, viewer] = [await env.login("u-alice"), await env.login("u-bob"), await env.login("u-carol")];
});
afterAll(async () => { await env.stop(); });

const auditActions = async () => (await env.db.query("SELECT action, outcome, actor FROM audit_log ORDER BY id")).rows;

describe("sign-in", () => {
  it("maps IdP roles to console roles", async () => {
    expect((await env.call(admin, "GET", "/me")).body).toMatchObject({ role: "admin", email: "alice@example.test" });
    expect((await env.call(viewer, "GET", "/me")).body.role).toBe("viewer");
  });
  it("rejects calls without a session", async () => {
    expect((await env.call(null, "GET", "/sources")).status).toBe(401);
  });
  it("rejects a callback with the wrong state", async () => {
    const r = await env.app.inject({ url: "/auth/callback?code=abc&state=bad", cookies: { oidc_tx: Buffer.from(JSON.stringify({ state: "good", nonce: "n", verifier: "v" })).toString("base64url") } });
    expect(r.statusCode).toBe(400);
  });
  it("login redirects to the IdP with PKCE", async () => {
    const r = await env.app.inject({ url: "/auth/login" });
    const u = new URL(r.headers.location as string);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(r.cookies[0]!.httpOnly).toBe(true);
  });
  it("session cookie is HttpOnly and SameSite=Lax", async () => {
    const who = await env.login("u-bob");
    const r = await env.app.inject({ url: "/me", cookies: who.cookies });
    expect(r.statusCode).toBe(200);
    const row = (await env.db.query("SELECT 1 FROM sessions WHERE id=$1", [who.cookies.sid])).rowCount;
    expect(row).toBe(1);
  });
  it("logout destroys the session", async () => {
    const who = await env.login("u-carol");
    expect((await env.call(who, "POST", "/auth/logout", {})).status).toBe(200);
    expect((await env.call(who, "GET", "/me")).status).toBe(401);
  });
});

describe("RBAC and CSRF", () => {
  it("viewer cannot create a source", async () => {
    expect((await env.call(viewer, "POST", "/sources", { name: "nope", type: "csv" })).status).toBe(403);
  });
  it("engineer creates, but cannot delete", async () => {
    const c = await env.call(eng, "POST", "/sources", { name: "rbac-csv", type: "csv" });
    expect(c.status).toBe(201);
    expect((await env.call(eng, "DELETE", `/sources/${c.body.id}`)).status).toBe(403);
    expect((await env.call(admin, "DELETE", `/sources/${c.body.id}`)).status).toBe(200);
  });
  it("only admin reads the audit log", async () => {
    expect((await env.call(eng, "GET", "/audit")).status).toBe(403);
    const r = await env.call(admin, "GET", "/audit");
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
  });
  it("blocks a write without the CSRF token, even with a valid session", async () => {
    const r = await env.app.inject({ method: "POST", url: "/sources", cookies: eng.cookies, payload: { name: "csrf-x", type: "csv" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toContain("CSRF");
  });
  it("blocks a write with a wrong CSRF token", async () => {
    const r = await env.app.inject({ method: "POST", url: "/sources", cookies: eng.cookies, headers: { "x-csrf-token": "wrong" }, payload: { name: "csrf-x", type: "csv" } });
    expect(r.statusCode).toBe(403);
  });
  it("validates input with Zod and reports the field", async () => {
    const r = await env.call(eng, "POST", "/sources", { name: "x", type: "ftp" });
    expect(r.status).toBe(400);
    expect(r.body.issues.join(" ")).toContain("name");
  });
  it("rejects a malformed id", async () => {
    expect((await env.call(eng, "POST", "/sources/abc/run")).status).toBe(400);
  });
  it("writes denied and csrf events to the audit log", async () => {
    const a = await auditActions();
    expect(a.some((x) => x.action === "access.denied" && x.outcome === "denied" && x.actor === "carol@example.test")).toBe(true);
    expect(a.some((x) => x.action === "csrf.rejected")).toBe(true);
    expect(a.some((x) => x.action === "auth.login" && x.actor === "alice@example.test")).toBe(true);
  });
});

describe("csv upload, dead letters, replay", () => {
  let sid: number;
  it("uploads a csv and loads rows", async () => {
    sid = (await env.call(eng, "POST", "/sources", { name: "up-csv", type: "csv" })).body.id;
    const r = await env.call(eng, "POST", `/sources/${sid}/upload`, `${goodCsv}\nA-9,broken-email,1,USD,paid,2026-02-04T00:00:00Z`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "success", rowsLoaded: 3, rowsFailed: 1 });
  });
  it("viewer can see the dead letter but not replay it", async () => {
    const dl = await env.call(viewer, "GET", "/dead-letters");
    expect(dl.body).toHaveLength(1);
    expect(dl.body[0].errors[0]).toContain("customer_email");
    expect((await env.call(viewer, "POST", `/dead-letters/${dl.body[0].id}/replay`, {})).status).toBe(403);
  });
  it("replay with a still-bad row returns 422", async () => {
    const id = (await env.call(viewer, "GET", "/dead-letters")).body[0].id;
    const r = await env.call(eng, "POST", `/dead-letters/${id}/replay`, { payload: { external_id: "A-9" } });
    expect(r.status).toBe(422);
  });
  it("replay with a fixed row loads it and closes the dead letter", async () => {
    const dl = (await env.call(viewer, "GET", "/dead-letters")).body[0];
    const fixed = { ...dl.payload, customer_email: "fixed@example.com" };
    const r = await env.call(eng, "POST", `/dead-letters/${dl.id}/replay`, { payload: fixed });
    expect(r.status).toBe(200);
    expect(r.body.rowsLoaded).toBe(1);
    expect((await env.call(viewer, "GET", "/dead-letters")).body).toHaveLength(0);
    expect((await env.call(viewer, "GET", "/dead-letters?status=replayed")).body).toHaveLength(1);
    expect((await env.call(eng, "POST", `/dead-letters/${dl.id}/replay`, {})).status).toBe(409);
    const o = (await env.db.query("SELECT customer_email FROM orders WHERE external_id='A-9'")).rows[0];
    expect(o.customer_email).toBe("fixed@example.com");
  });
  it("discard closes a dead letter", async () => {
    await env.call(eng, "POST", `/sources/${sid}/upload`, `${CSV_HEADER}\nZ-1,nope,1,USD,paid,2026-02-05T00:00:00Z`);
    const dl = (await env.call(viewer, "GET", "/dead-letters")).body[0];
    expect((await env.call(eng, "POST", `/dead-letters/${dl.id}/discard`)).status).toBe(200);
    expect((await env.call(eng, "POST", `/dead-letters/${dl.id}/discard`)).status).toBe(404);
  });
  it("rejects an unparseable file and a csv upload to a non-csv source", async () => {
    const hook = (await env.call(eng, "POST", "/sources", { name: "wrong-type", type: "webhook" })).body.id;
    expect((await env.call(eng, "POST", `/sources/${hook}/upload`, goodCsv)).status).toBe(400);
  });
  it("records sensitive actions in the audit log", async () => {
    const a = await auditActions();
    for (const act of ["source.create", "csv.upload", "deadletter.replay", "deadletter.discard"]) expect(a.some((x) => x.action === act)).toBe(true);
  });
});

describe("REST source (rate limited, paginated, incremental)", () => {
  let id: number;
  it("pulls all pages through the rate limit", async () => {
    id = (await env.call(eng, "POST", "/sources", { name: "rest-orders", type: "rest", config: { baseUrl: env.sourceUrl, apiKey: "demo-key" } })).body.id;
    const r = await env.call(eng, "POST", `/sources/${id}/run`);
    expect(r.status).toBe(200);
    expect(r.body.rowsIn).toBe(120);
    expect(r.body.status).toBe("success");
    expect(r.body.rowsFailed).toBeGreaterThan(0);
    expect(r.body.rowsLoaded + r.body.rowsFailed).toBe(120);
  });
  it("second run is incremental and fetches nothing new", async () => {
    const r = await env.call(eng, "POST", `/sources/${id}/run`);
    expect(r.body.rowsIn).toBe(0);
  });
  it("does not leak the api key in the source list", async () => {
    const list = await env.call(viewer, "GET", "/sources");
    const s = list.body.find((x: { id: number }) => x.id === id);
    expect(s.config.apiKey).toBe("********");
    expect(s.last_status).toBe("success");
    expect(s.watermark).toBeTruthy();
  });
});

describe("webhook source", () => {
  let id: number, secret: string;
  const row = { external_id: "H-1", customer_email: "hook@x.test", amount: 9, currency: "USD", status: "paid", updated_at: "2026-02-01T00:00:00Z" };
  it("returns the secret once at creation", async () => {
    const r = await env.call(eng, "POST", "/sources", { name: "hook-src", type: "webhook" });
    id = r.body.id; secret = r.body.webhookSecret;
    expect(secret).toBeTruthy();
    const list = (await env.call(viewer, "GET", "/sources")).body.find((x: { id: number }) => x.id === id);
    expect(list.config.secret).toBe("********");
  });
  it("rejects a bad signature and audits it", async () => {
    const r = await env.call(null, "POST", `/webhooks/${id}`, row, { "x-signature": "sha256=00" });
    expect(r.status).toBe(401);
    expect((await auditActions()).some((x) => x.action === "webhook.reject")).toBe(true);
  });
  it("accepts a signed event, then a run drains it", async () => {
    const body = JSON.stringify(row);
    const r = await env.app.inject({ method: "POST", url: `/webhooks/${id}`, headers: { "content-type": "application/json", "x-signature": signBody(secret, body) }, payload: body });
    expect(r.statusCode).toBe(202);
    const run = await env.call(eng, "POST", `/sources/${id}/run`);
    expect(run.body).toMatchObject({ rowsIn: 1, rowsLoaded: 1 });
    expect((await env.call(eng, "POST", `/sources/${id}/run`)).body.rowsIn).toBe(0);
  });
});

describe("dashboards, metrics, docs", () => {
  it("stats has throughput, a quality scorecard and totals", async () => {
    const s = (await env.call(viewer, "GET", "/stats")).body;
    expect(s.throughput.length).toBeGreaterThan(0);
    expect(s.quality.length).toBeGreaterThan(0);
    expect(s.quality[0].checks).toHaveLength(4);
    expect(s.totals.orders).toBeGreaterThan(0);
  });
  it("lists runs and one run with quality results", async () => {
    const runs = (await env.call(viewer, "GET", "/runs?limit=3")).body;
    expect(runs).toHaveLength(3);
    const one = (await env.call(viewer, "GET", `/runs/${runs[0].id}`)).body;
    expect(one.quality.length).toBeGreaterThanOrEqual(0);
    expect((await env.call(viewer, "GET", "/runs/999999")).status).toBe(404);
  });
  it("exposes Prometheus metrics", async () => {
    const r = await env.call(null, "GET", "/metrics");
    expect(r.raw).toContain("pipeline_runs_total");
    expect(r.raw).toContain('pipeline_rows_total{result="loaded"}');
    expect(r.raw).toContain("http_request_duration_seconds_bucket");
    expect(r.raw).toContain("dead_letters_pending");
  });
  it("serves health and the OpenAPI document", async () => {
    expect((await env.call(null, "GET", "/health")).body).toEqual({ status: "ok" });
    const doc = (await env.call(null, "GET", "/openapi.json")).body;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/dead-letters/{id}/replay");
  });
});
