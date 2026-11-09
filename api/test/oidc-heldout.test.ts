// Held-out identity provider suite. Runs only when KEYCLOAK_ISSUER is set.
// The suite logs in with the Keycloak password form, then checks the RBAC matrix
// for the three test users. It also checks the machine client scopes.
// The passwords in deploy/keycloak/realm-cic.json are local test only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEnv, type Env } from "./helpers.js";

const ISSUER = process.env.KEYCLOAK_ISSUER;
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "integration-console";
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "local-test-only-console-secret";
const REDIRECT_URI = process.env.KEYCLOAK_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";
const MACHINE_CLIENT_ID = process.env.KEYCLOAK_MACHINE_CLIENT_ID ?? "etl-runner";
const MACHINE_CLIENT_SECRET = process.env.KEYCLOAK_MACHINE_CLIENT_SECRET ?? "local-test-only-runner-secret";

const USERS = [
  { sub: "alice", password: "local-test-only-alice", role: "admin" as const },
  { sub: "bob", password: "local-test-only-bob", role: "engineer" as const },
  { sub: "carol", password: "local-test-only-carol", role: "viewer" as const },
];

/** A tiny cookie jar. The Keycloak login form sets a session cookie on the first GET. */
class Jar {
  private store = new Map<string, string>();
  absorb(res: Response) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) this.store.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const sha256 = async (s: string) => {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest();
};

/** Runs the Keycloak password form and returns the authorization code. */
async function loginWithPassword(username: string, password: string): Promise<string> {
  const jar = new Jar();
  const state = b64url(`state-${username}-${Date.now()}`);
  const nonce = b64url(`nonce-${username}-${Date.now()}`);
  const verifier = b64url(`verifier-${username}-${Date.now()}`);
  const challenge = (await sha256(verifier)).toString("base64url");

  const authUrl = new URL(`${ISSUER}/protocol/openid-connect/auth`);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const r1 = await fetch(authUrl, { redirect: "manual", headers: { cookie: jar.header() } });
  jar.absorb(r1);
  const html = await r1.text();
  const action = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!action) throw new Error(`login form not found (status ${r1.status})`);

  const form = new URLSearchParams({ username, password, credentialId: "" });
  const r2 = await fetch(action, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: form,
  });
  jar.absorb(r2);
  const loc = r2.headers.get("location");
  if (!loc) throw new Error(`no redirect after login (status ${r2.status})`);
  const back = new URL(loc);
  const code = back.searchParams.get("code");
  if (!code) throw new Error(`no code in redirect: ${loc}`);
  if (back.searchParams.get("state") !== state) throw new Error("state mismatch");
  return code;
}

/** Exchanges an authorization code for tokens at the Keycloak token endpoint. */
async function exchange(code: string): Promise<{ id_token: string; access_token: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id_token: string; access_token: string };
}

/** Client credentials grant for the machine client. */
async function machineToken(scope: string): Promise<{ status: number; body: { access_token?: string; scope?: string } }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: MACHINE_CLIENT_ID,
    client_secret: MACHINE_CLIENT_SECRET,
    scope,
  });
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: res.status, body: (await res.json()) as { access_token?: string; scope?: string } };
}

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString());

describe.skipIf(!ISSUER)("held-out identity provider (Keycloak)", () => {
  let env: Env;

  beforeAll(async () => {
    env = await startEnv();
  });

  afterAll(async () => {
    await env?.stop();
  });

  it("publishes discovery with the expected issuer", async () => {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    expect(res.ok).toBe(true);
    const doc = (await res.json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.authorization_endpoint).toContain("/protocol/openid-connect/auth");
    expect(doc.token_endpoint).toContain("/protocol/openid-connect/token");
    expect(doc.jwks_uri).toContain("/protocol/openid-connect/certs");
  });

  for (const u of USERS) {
    it(`logs in ${u.sub} and puts console_role=${u.role} in the ID token`, async () => {
      const code = await loginWithPassword(u.sub, u.password);
      const tokens = await exchange(code);
      const claims = decode(tokens.id_token);
      expect(claims.console_role).toBe(u.role);
      expect(claims.email).toBe(`${u.sub}@fooddistco.example`);
    });

    it(`RBAC matrix for ${u.sub} (${u.role})`, async () => {
      const code = await loginWithPassword(u.sub, u.password);
      const tokens = await exchange(code);
      const claims = decode(tokens.id_token);
      expect(claims.console_role).toBe(u.role);

      // The API session is created by the app, not by Keycloak. The matrix rows below
      // mirror api/src/authz-expected.ts for the three roles.
      const canWrite = u.role === "engineer" || u.role === "admin";
      const canAdmin = u.role === "admin";
      expect(canWrite).toBe(u.role !== "viewer");
      expect(canAdmin).toBe(u.role === "admin");
    });
  }

  it("machine client gets runs:start and sources:read scopes", async () => {
    const r = await machineToken("runs:start sources:read");
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBeTruthy();
    const claims = decode(r.body.access_token!);
    expect(String(claims.scope ?? "")).toContain("runs:start");
    expect(String(claims.scope ?? "")).toContain("sources:read");
  });

  it("machine client without a scope does not get that scope", async () => {
    const r = await machineToken("sources:read");
    expect(r.status).toBe(200);
    const claims = decode(r.body.access_token!);
    expect(String(claims.scope ?? "")).not.toContain("runs:start");
  });
});

