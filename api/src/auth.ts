import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Role } from "./schemas.js";

export const RANK: Record<Role, number> = { viewer: 1, engineer: 2, admin: 3 };

export const canAccess = (have: Role, need: Role) => RANK[have] >= RANK[need];

/** The highest known role in the `roles` claim. Unknown or missing roles give nothing (deny). */
export function roleFromClaims(claims: unknown): Role | null {
  const list = Array.isArray(claims) ? claims : [];
  const known = list.filter((r): r is Role => r === "admin" || r === "engineer" || r === "viewer");
  return known.sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
}

export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export type Session = { id: string; email: string; name: string; role: Role; csrf: string };

export async function createSession(db: Db, cfg: Config, u: { email: string; name: string; role: Role }): Promise<Session> {
  const s = { id: newToken(), csrf: newToken(16), ...u };
  await db.query(
    "INSERT INTO sessions (id, user_email, user_name, role, csrf_token, expires_at) VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' minutes')::interval)",
    [s.id, u.email, u.name, u.role, s.csrf, String(cfg.SESSION_TTL_MINUTES)],
  );
  return s;
}

export async function loadSession(db: Db, id: string | undefined): Promise<Session | null> {
  if (!id) return null;
  const r = (await db.query("SELECT id, user_email, user_name, role, csrf_token FROM sessions WHERE id=$1 AND expires_at > now()", [id])).rows[0];
  return r ? { id: r.id, email: r.user_email, name: r.user_name, role: r.role, csrf: r.csrf_token } : null;
}

export const deleteSession = (db: Db, id: string) => db.query("DELETE FROM sessions WHERE id=$1", [id]);

/** Builds the URL that sends the browser to the identity provider (code flow + PKCE + state + nonce). */
export function authorizeUrl(cfg: Config, redirectUri: string, tx: { state: string; nonce: string; verifier: string }): string {
  const u = new URL("/authorize", cfg.OIDC_ISSUER);
  u.search = new URLSearchParams({
    response_type: "code", client_id: cfg.OIDC_CLIENT_ID, redirect_uri: redirectUri, scope: "openid profile email",
    state: tx.state, nonce: tx.nonce, code_challenge: pkceChallenge(tx.verifier), code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

/** Swaps the code for tokens, then checks signature, issuer, audience, expiry and nonce. */
export async function exchangeCode(cfg: Config, code: string, redirectUri: string, verifier: string, nonce: string) {
  const res = await fetch(new URL("/token", cfg.oidcInternal), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: cfg.OIDC_CLIENT_ID, client_secret: cfg.OIDC_CLIENT_SECRET, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error("token exchange failed");
  const { id_token } = (await res.json()) as { id_token: string };
  const jwks = createRemoteJWKSet(new URL("/jwks", cfg.oidcInternal));
  const { payload } = await jwtVerify(id_token, jwks, { issuer: cfg.OIDC_ISSUER, audience: cfg.OIDC_CLIENT_ID });
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  return payload;
}
