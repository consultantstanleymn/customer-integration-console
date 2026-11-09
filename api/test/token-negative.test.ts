import { afterEach, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWK, KeyLike } from "jose";
import { verifyIdToken } from "../src/auth.js";
import { startEnv, type Env } from "./helpers.js";

const ISSUER = "https://idp.example.test";
const AUDIENCE = "integration-console";
const NONCE = "nonce-abc";

type Keys = { privateKey: KeyLike; publicKey: KeyLike; jwk: JWK };

async function makeKeys(kid: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  return { privateKey, publicKey, jwk };
}

function sign(keys: Keys, over: { issuer?: string; audience?: string; nonce?: string | null; exp?: string; kid?: string } = {}) {
  const payload: Record<string, unknown> = { name: "Test User", email: "test@example.test", roles: ["viewer"] };
  if (over.nonce !== null) payload.nonce = over.nonce ?? NONCE;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: over.kid ?? "key-1" })
    .setIssuer(over.issuer ?? ISSUER)
    .setAudience(over.audience ?? AUDIENCE)
    .setSubject("u-test")
    .setIssuedAt()
    .setExpirationTime(over.exp ?? "5m")
    .sign(keys.privateKey);
}

describe("verifyIdToken", () => {
  it("accepts a valid token", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys);
    const payload = await verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE });
    expect(payload.sub).toBe("u-test");
    expect(payload.nonce).toBe(NONCE);
  });

  it("rejects an expired token", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys, { exp: "1s" });
    await new Promise((r) => setTimeout(r, 1500));
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects a wrong audience", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys, { audience: "some-other-client" });
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects a wrong issuer", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys, { issuer: "https://evil.example.test" });
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects an unknown kid", async () => {
    const keys = await makeKeys("key-1");
    const other = await makeKeys("key-2");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(other, { kid: "key-2" });
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects a tampered signature", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys);
    const [h, p, s] = token.split(".");
    const flipped = s!.slice(0, -2) + (s!.endsWith("AA") ? "BB" : "AA");
    await expect(verifyIdToken(`${h}.${p}.${flipped}`, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects alg none", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const header = Buffer.from(JSON.stringify({ alg: "none", kid: "key-1" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: "u-test", nonce: NONCE, exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
    await expect(verifyIdToken(`${header}.${body}.`, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects HS256 signed with the public key", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const secret = new TextEncoder().encode(JSON.stringify(keys.jwk));
    const token = await new SignJWT({ nonce: NONCE })
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("u-test")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow();
  });

  it("rejects a missing nonce", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys, { nonce: null });
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow("nonce mismatch");
  });

  it("rejects a wrong nonce", async () => {
    const keys = await makeKeys("key-1");
    const jwks = createLocalJWKSet({ keys: [keys.jwk] });
    const token = await sign(keys, { nonce: "nonce-other" });
    await expect(verifyIdToken(token, jwks, { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE })).rejects.toThrow("nonce mismatch");
  });
});

describe("callback rejects and audits", () => {
  let env: Env | undefined;
  afterEach(async () => { await env?.stop(); env = undefined; });

  /** Runs the login start, then the mock authorize step, and returns the code and state. */
  async function startLogin(e: Env, sub: "u-alice" | "u-bob" | "u-carol") {
    const r1 = await e.app.inject({ url: "/auth/login" });
    const tx = r1.cookies.find((c) => c.name === "oidc_tx")!.value;
    const q = new URL(r1.headers.location as string).searchParams;
    const form = new URLSearchParams({ client_id: q.get("client_id")!, redirect_uri: q.get("redirect_uri")!, state: q.get("state")!, nonce: q.get("nonce")!, code_challenge: q.get("code_challenge")!, sub });
    const r2 = await fetch(`${e.cfg.OIDC_ISSUER}/authorize`, { method: "POST", body: form, redirect: "manual" });
    const back = new URL(r2.headers.get("location")!);
    return { tx, code: back.searchParams.get("code")!, state: back.searchParams.get("state")! };
  }

  async function failedRows(e: Env) {
    const r = await e.db.query("SELECT actor, action, outcome, detail FROM audit_log WHERE action = 'auth.login_failed' ORDER BY id");
    return r.rows as { actor: string; action: string; outcome: string; detail: { reason: string } }[];
  }

  it("replayed code is rejected and audited", async () => {
    env = await startEnv();
    const { tx, code, state } = await startLogin(env, "u-alice");
    const first = await env.app.inject({ url: `/auth/callback?code=${code}&state=${state}`, cookies: { oidc_tx: tx } });
    expect(first.statusCode).toBe(302);
    const second = await env.app.inject({ url: `/auth/callback?code=${code}&state=${state}`, cookies: { oidc_tx: tx } });
    expect(second.statusCode).toBe(401);
    const rows = await failedRows(env);
    expect(rows.length).toBe(1);
    expect(rows[0]!.actor).toBe("anonymous");
    expect(rows[0]!.outcome).toBe("error");
    expect(rows[0]!.detail.reason).toBe("code_replayed");
  });

  it("bad state is audited", async () => {
    env = await startEnv();
    const { tx, code } = await startLogin(env, "u-alice");
    const res = await env.app.inject({ url: `/auth/callback?code=${code}&state=wrong-state`, cookies: { oidc_tx: tx } });
    expect(res.statusCode).toBe(400);
    const rows = await failedRows(env);
    expect(rows.length).toBe(1);
    expect(rows[0]!.actor).toBe("anonymous");
    expect(rows[0]!.outcome).toBe("error");
    expect(rows[0]!.detail.reason).toBe("bad_state");
  });
});
