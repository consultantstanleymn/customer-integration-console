import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { decodeJwt } from "jose";
import { createOidc } from "../src/oidc.js";
import { createSource, makeOrders } from "../src/source.js";

let oidc: Server, base: string;
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

beforeAll(async () => {
  const probe = createSource(); // only to grab a free port number
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  probe.close();
  base = `http://127.0.0.1:${port}`;
  oidc = await createOidc({ issuer: base, clientId: "c", clientSecret: "s" });
  await new Promise<void>((r) => oidc.listen(port, "127.0.0.1", r));
});
afterAll(() => { oidc.close(); });

async function getCode(sub = "u-bob") {
  const f = new URLSearchParams({ client_id: "c", redirect_uri: "http://app.test/cb", state: "st", nonce: "nn", code_challenge: challenge, sub });
  const r = await fetch(`${base}/authorize`, { method: "POST", body: f, redirect: "manual" });
  return new URL(r.headers.get("location")!).searchParams.get("code")!;
}
const token = (code: string, v = verifier, secret = "s") =>
  fetch(`${base}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://app.test/cb", client_id: "c", client_secret: secret, code_verifier: v }) });

describe("mock OIDC provider", () => {
  it("publishes discovery and keys", async () => {
    const d = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
    expect(d.issuer).toBe(base);
    expect((await (await fetch(`${base}/jwks`)).json()).keys[0].kid).toBe("mock-1");
  });
  it("issues an ID token with role and nonce", async () => {
    const res = await token(await getCode());
    const claims = decodeJwt((await res.json()).id_token);
    expect(claims).toMatchObject({ email: "bob@example.test", roles: ["engineer"], nonce: "nn", aud: "c", iss: base });
  });
  it("rejects a wrong PKCE verifier", async () => {
    expect((await token(await getCode(), "w".repeat(43))).status).toBe(400);
  });
  it("rejects a wrong client secret", async () => {
    expect((await token(await getCode(), verifier, "bad")).status).toBe(400);
  });
  it("accepts a code only once", async () => {
    const code = await getCode();
    expect((await token(code)).status).toBe(200);
    expect((await token(code)).status).toBe(400);
  });
  it("refuses an authorize request without PKCE", async () => {
    expect((await fetch(`${base}/authorize?client_id=c&redirect_uri=http://x&response_type=code`)).status).toBe(400);
  });
});

describe("mock REST source", () => {
  let srv: Server, url: string;
  beforeAll(async () => {
    srv = createSource({ rateLimit: 1, windowMs: 60_000 });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => { srv.close(); });
  it("needs the api key", async () => {
    expect((await fetch(`${url}/orders`)).status).toBe(401);
  });
  it("pages with a cursor", async () => {
    const r = await (await fetch(`${url}/orders?limit=50`, { headers: { "x-api-key": "demo-key" } })).json();
    expect(r.data).toHaveLength(50);
    expect(r.next_cursor).toBe("50");
  });
  it("answers 429 with Retry-After when the limit is hit", async () => {
    const r = await fetch(`${url}/orders`, { headers: { "x-api-key": "demo-key" } });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("generates a few broken rows on purpose", () => {
    expect(makeOrders(120).filter((o) => o.customer_email === "not-an-email").length).toBeGreaterThan(0);
  });
});
