import type { Server } from "node:http";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { createOidc } from "../../mocks/src/oidc.js";
import { createSource } from "../../mocks/src/source.js";
// @ts-expect-error plain .mjs helper without types
import { freePort } from "../../scripts/pg-local.mjs";

export async function freshDb(): Promise<Db> {
  const db = createPool(process.env.TEST_DATABASE_URL!);
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(db);
  return db;
}

const listen = (s: Server, port: number) => new Promise<void>((r) => s.listen(port, "127.0.0.1", r));

export type Env = Awaited<ReturnType<typeof startEnv>>;

/** A full stack in-process: Postgres (from global setup), mock OIDC, mock REST source and the API app. */
export async function startEnv(sourceOpts: Parameters<typeof createSource>[0] = {}) {
  const db = await freshDb();
  const oidcPort: number = await freePort();
  const issuer = `http://127.0.0.1:${oidcPort}`;
  const oidc = await createOidc({ issuer, clientId: "integration-console", clientSecret: "dev-only-secret" });
  await listen(oidc, oidcPort);
  const srcPort: number = await freePort();
  const source = createSource(sourceOpts);
  await listen(source, srcPort);
  const cfg: Config = loadConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL!, OIDC_ISSUER: issuer, LOG_LEVEL: "silent", WEB_URL: "http://localhost:3999" });
  const app = await buildApp(db, cfg);
  await app.ready();

  type Who = { cookies: { sid: string }; csrf: string; email: string };

  async function login(sub: "u-alice" | "u-bob" | "u-carol"): Promise<Who> {
    const r1 = await app.inject({ url: "/auth/login" });
    const tx = r1.cookies.find((c) => c.name === "oidc_tx")!.value;
    const q = new URL(r1.headers.location as string).searchParams;
    const form = new URLSearchParams({ client_id: q.get("client_id")!, redirect_uri: q.get("redirect_uri")!, state: q.get("state")!, nonce: q.get("nonce")!, code_challenge: q.get("code_challenge")!, sub });
    const r2 = await fetch(`${issuer}/authorize`, { method: "POST", body: form, redirect: "manual" });
    const back = new URL(r2.headers.get("location")!);
    const r3 = await app.inject({ url: `/auth/callback?code=${back.searchParams.get("code")}&state=${back.searchParams.get("state")}`, cookies: { oidc_tx: tx } });
    const sid = r3.cookies.find((c) => c.name === "sid")?.value;
    if (!sid) throw new Error(`login failed: ${r3.statusCode} ${r3.body}`);
    const me = (await app.inject({ url: "/me", cookies: { sid } })).json();
    return { cookies: { sid }, csrf: me.csrfToken, email: me.email };
  }

  /** Calls the API as a logged in user, with the CSRF header on writes. */
  async function call(who: Who | null, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const isText = typeof payload === "string";
    const res = await app.inject({
      method, url, cookies: who?.cookies, payload: payload as string | object | undefined,
      headers: { ...(who && method !== "GET" ? { "x-csrf-token": who.csrf } : {}), ...(isText ? { "content-type": "text/csv" } : {}), ...headers },
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res.body };
  }

  return {
    db, app, cfg, login, call,
    sourceUrl: `http://127.0.0.1:${srcPort}`,
    async stop() { await app.close(); oidc.close(); source.close(); await db.end(); },
  };
}

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

export const CSV_HEADER = "external_id,customer_email,amount,currency,status,updated_at";
export const goodCsv = [
  CSV_HEADER,
  "A-1,Ann@Example.com,10.50,usd,Paid,2026-02-01T10:00:00Z",
  "A-2,bob@example.com,20,EUR,pending,2026-02-02T10:00:00Z",
  "A-3,ann@example.com,5.25,USD,cancelled,2026-02-03T10:00:00Z",
].join("\n");
