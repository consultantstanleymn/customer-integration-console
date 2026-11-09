import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWK, KeyLike } from "jose";
import { verifyIdToken } from "../src/auth.js";

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
