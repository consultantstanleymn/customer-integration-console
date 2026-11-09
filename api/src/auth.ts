import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Role } from "./schemas.js";
import { discover } from "./oidc-discovery.js";

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

export type Session = { id: string; email: string; name: string; role: Role; csrf: string; machine?: boolean };

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

/** The API calls the token and JWKS endpoints on the internal URL. The browser uses the public one. */
function toInternal(cfg: Config, url: string): string {
  return url.startsWith(cfg.OIDC_ISSUER) ? cfg.oidcInternal + url.slice(cfg.OIDC_ISSUER.length) : url;
}

/** The authorization endpoint. Discovery is used unless the setting turns it off. */
async function authorizationEndpoint(cfg: Config): Promise<string> {
  if (cfg.OIDC_DISCOVERY === "false") return new URL("/authorize", cfg.OIDC_ISSUER).toString();
  return (await discover(cfg.oidcInternal, fetch, cfg.OIDC_ISSUER)).authorization_endpoint;
}

/** The token endpoint. Discovery is used unless the setting turns it off. */
async function tokenEndpoint(cfg: Config): Promise<string> {
  if (cfg.OIDC_DISCOVERY === "false") return new URL("/token", cfg.oidcInternal).toString();
  return toInternal(cfg, (await discover(cfg.oidcInternal, fetch, cfg.OIDC_ISSUER)).token_endpoint);
}

/** The JWKS URL. Discovery is used unless the setting turns it off. */
export async function jwksUri(cfg: Config): Promise<string> {
  if (cfg.OIDC_DISCOVERY === "false") return new URL("/jwks", cfg.oidcInternal).toString();
  return toInternal(cfg, (await discover(cfg.oidcInternal, fetch, cfg.OIDC_ISSUER)).jwks_uri);
}

/** One remote key set per JWKS URL. The set caches keys and refetches on an unknown kid. */
const jwksCache = new Map<string, JWTVerifyGetKey>();
async function jwksFor(cfg: Config): Promise<JWTVerifyGetKey> {
  const uri = await jwksUri(cfg);
  let set = jwksCache.get(uri);
  if (!set) { set = createRemoteJWKSet(new URL(uri)); jwksCache.set(uri, set); }
  return set;
}

/**
 * Checks a machine access token. It verifies the signature (RS256 only), the issuer, the audience
 * and the expiry. Any failure throws. The scopes come from the space-separated `scope` claim.
 */
export async function verifyBearer(cfg: Config, token: string) {
  const { payload } = await jwtVerify(token, await jwksFor(cfg), {
    issuer: cfg.OIDC_ISSUER,
    audience: cfg.API_AUDIENCE,
    algorithms: ["RS256"],
  });
  return payload;
}

/** The scopes in a verified token payload. */
export function scopesOf(payload: { scope?: unknown }): string[] {
  return typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
}

/** Builds the URL that sends the browser to the identity provider (code flow + PKCE + state + nonce). */
export async function authorizeUrl(cfg: Config, redirectUri: string, tx: { state: string; nonce: string; verifier: string }): Promise<string> {
  const u = new URL(await authorizationEndpoint(cfg));
  u.search = new URLSearchParams({
    response_type: "code", client_id: cfg.OIDC_CLIENT_ID, redirect_uri: redirectUri, scope: "openid profile email",
    state: tx.state, nonce: tx.nonce, code_challenge: pkceChallenge(tx.verifier), code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

/**
 * Checks an ID token. It verifies the signature (RS256 only), the issuer, the audience and the expiry.
 * It then checks the nonce. Any failure throws.
 */
export async function verifyIdToken(
  idToken: string,
  jwks: JWTVerifyGetKey,
  opts: { issuer: string; audience: string; nonce: string; maxClockSkewSec?: number },
) {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: ["RS256"],
    clockTolerance: opts.maxClockSkewSec ?? 0,
  });
  if (payload.nonce !== opts.nonce) throw new Error("nonce mismatch");
  return payload;
}

/** Swaps the code for tokens, then checks signature, issuer, audience, expiry and nonce. */
export async function exchangeCode(cfg: Config, code: string, redirectUri: string, verifier: string, nonce: string) {
  const res = await fetch(await tokenEndpoint(cfg), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: cfg.OIDC_CLIENT_ID, client_secret: cfg.OIDC_CLIENT_SECRET, code_verifier: verifier }),
  });
  if (!res.ok) {
    // The IdP answers invalid_grant for a code that is unknown or already used.
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error === "invalid_grant" ? "invalid_grant" : "token exchange failed");
  }
  const { id_token } = (await res.json()) as { id_token: string };
  const jwks = createRemoteJWKSet(new URL(await jwksUri(cfg)));
  return verifyIdToken(id_token, jwks, { issuer: cfg.OIDC_ISSUER, audience: cfg.OIDC_CLIENT_ID, nonce });
}
