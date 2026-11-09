import { describe, expect, it } from "vitest";
import { startEnv, type Env } from "./helpers.js";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("machine access tokens and scopes", () => {
  let env: Env;
  let sourceId: number;

  it("prepares the environment", async () => {
    env = await startEnv();
    const r = await env.db.query("INSERT INTO sources (name, type, config, created_by) VALUES ('api feed','rest',$1,'test') RETURNING id", [JSON.stringify({ baseUrl: env.sourceUrl, apiKey: "demo-key" })]);
    sourceId = r.rows[0].id;
  });

  it("machine token with scope starts a run", async () => {
    const token = await env.machineToken("runs:start");
    const res = await env.call(null, "POST", `/sources/${sourceId}/run`, undefined, bearer(token));
    expect(res.status, res.raw).toBe(200);
    const row = (await env.db.query("SELECT actor, role, action FROM audit_log WHERE action='pipeline.run' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(row.actor).toBe("client:etl-runner");
    expect(row.role).toBe("machine");
  });

  it("machine token without scope gets 403", async () => {
    const token = await env.machineToken("sources:read");
    const res = await env.call(null, "POST", `/sources/${sourceId}/run`, undefined, bearer(token));
    expect(res.status, res.raw).toBe(403);
    const row = (await env.db.query("SELECT actor, role, action, outcome FROM audit_log WHERE action='access.denied' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(row.actor).toBe("client:etl-runner");
    expect(row.role).toBe("machine");
    expect(row.outcome).toBe("denied");
  });

  it("machine token on a route without scopes gets 403", async () => {
    const token = await env.machineToken("runs:start sources:read");
    const res = await env.call(null, "GET", "/runs", undefined, bearer(token));
    expect(res.status, res.raw).toBe(403);
  });

  it("expired machine token gets 401", async () => {
    const token = await env.machineToken("runs:start", "test-runner-secret", 1);
    await new Promise((r) => setTimeout(r, 1500));
    const res = await env.call(null, "POST", `/sources/${sourceId}/run`, undefined, bearer(token));
    expect(res.status, res.raw).toBe(401);
  });

  it("machine token cannot read the audit log", async () => {
    const token = await env.machineToken("runs:start sources:read");
    const res = await env.call(null, "GET", "/audit", undefined, bearer(token));
    expect(res.status, res.raw).toBe(403);
  });

  it("machine token reads sources with the sources:read scope", async () => {
    const token = await env.machineToken("sources:read");
    const res = await env.call(null, "GET", "/sources", undefined, bearer(token));
    expect(res.status, res.raw).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("stops the environment", async () => { await env.stop(); });
});
