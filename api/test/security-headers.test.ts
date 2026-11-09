import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEnv, type Env } from "./helpers.js";

describe("security headers and login rate limit", () => {
  let env: Env;
  let limited: Env;

  beforeAll(async () => {
    env = await startEnv();
    limited = await startEnv({}, { LOGIN_RATE_PER_MIN: "3" });
  });

  afterAll(async () => {
    await env.stop();
    await limited.stop();
  });

  it("json responses carry security headers", async () => {
    const res = await env.app.inject({ url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("authenticated responses are no-store", async () => {
    const who = await env.login("u-alice");
    const res = await env.app.inject({ url: "/me", cookies: who.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("login is rate limited with Retry-After", async () => {
    let last = await limited.app.inject({ url: "/auth/login", remoteAddress: "10.9.9.1" });
    for (let i = 0; i < 3; i++) last = await limited.app.inject({ url: "/auth/login", remoteAddress: "10.9.9.1" });
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(last.json()).toEqual({ error: "too many login attempts" });
    const rows = await limited.db.query("SELECT actor, action, outcome, detail FROM audit_log WHERE action = 'auth.rate_limited'");
    expect(rows.rowCount).toBeGreaterThanOrEqual(1);
    expect(rows.rows[0].actor).toBe("anonymous");
    expect(rows.rows[0].outcome).toBe("denied");
    expect(rows.rows[0].detail.ip).toBe("10.9.9.1");
  });

  it("rate limit is per IP", async () => {
    for (let i = 0; i < 4; i++) await limited.app.inject({ url: "/auth/login", remoteAddress: "10.9.9.2" });
    const other = await limited.app.inject({ url: "/auth/login", remoteAddress: "10.9.9.3" });
    expect(other.statusCode).toBe(302);
  });
});
