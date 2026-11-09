import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { clearDiscoveryCache, discover } from "../src/oidc-discovery.js";
import { authorizeUrl, exchangeCode } from "../src/auth.js";
import { loadConfig, type Config } from "../src/config.js";
import { startEnv } from "./helpers.js";
// @ts-expect-error plain .mjs helper without types
import { freePort } from "../../scripts/pg-local.mjs";

const servers: Server[] = [];

afterEach(async () => {
  clearDiscoveryCache();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const listen = (s: Server, port: number) => new Promise<void>((r) => s.listen(port, "127.0.0.1", r));

/** A small server that answers the discovery document and counts hits per path. */
async function fakeIssuer(opts: { docIssuer?: string } = {}) {
  const hits: string[] = [];
  const port: number = await freePort();
  const issuer = `http://127.0.0.1:${port}`;
  const doc = {
    issuer: opts.docIssuer ?? issuer,
    authorization_endpoint: `${issuer}/custom/authorize`,
    token_endpoint: `${issuer}/custom/token`,
    jwks_uri: `${issuer}/custom/jwks`,
  };
  const s = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    hits.push(url.pathname);
    if (url.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(doc));
    }
    res.writeHead(404, "text/plain");
    res.end("not found");
  });
  await listen(s, port);
  servers.push(s);
  return { issuer, hits };
}

describe("oidc discovery", () => {
  it("uses endpoints from discovery", async () => {
    const fake = await fakeIssuer();
    const cfg: Config = loadConfig({ OIDC_ISSUER: fake.issuer, LOG_LEVEL: "silent" });
    const doc = await discover(cfg.oidcInternal);
    expect(doc.authorization_endpoint).toBe(`${fake.issuer}/custom/authorize`);
    expect(doc.token_endpoint).toBe(`${fake.issuer}/custom/token`);
    expect(doc.jwks_uri).toBe(`${fake.issuer}/custom/jwks`);

    const url = new URL(await authorizeUrl(cfg, "http://localhost:3999/api/auth/callback", { state: "s", nonce: "n", verifier: "v" }));
    expect(url.origin + url.pathname).toBe(`${fake.issuer}/custom/authorize`);
    expect(url.searchParams.get("client_id")).toBe("integration-console");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    // The token call goes to the discovered endpoint. The fake answers 404, so the exchange fails.
    await expect(exchangeCode(cfg, "code", "http://localhost:3999/api/auth/callback", "v", "n")).rejects.toThrow("token exchange failed");
    expect(fake.hits).toContain("/custom/token");
    expect(fake.hits).not.toContain("/token");
  });

  it("rejects discovery with a different issuer", async () => {
    const fake = await fakeIssuer({ docIssuer: "http://evil.example" });
    await expect(discover(fake.issuer)).rejects.toThrow("discovery issuer mismatch");
  });

  it("falls back to fixed paths when discovery is off", async () => {
    const fake = await fakeIssuer();
    const cfg: Config = loadConfig({ OIDC_ISSUER: fake.issuer, OIDC_DISCOVERY: "false", LOG_LEVEL: "silent" });
    const url = new URL(await authorizeUrl(cfg, "http://localhost:3999/api/auth/callback", { state: "s", nonce: "n", verifier: "v" }));
    expect(url.origin + url.pathname).toBe(`${fake.issuer}/authorize`);
    // No discovery request is made when the setting is off.
    expect(fake.hits).toEqual([]);
  });

  it("keeps the full login flow working with discovery on", async () => {
    const env = await startEnv();
    try {
      const who = await env.login("u-bob");
      expect(who.email).toBe("bob@example.test");
      const me = await env.call(who, "GET", "/me");
      expect(me.status).toBe(200);
      expect(me.body.role).toBe("engineer");
    } finally {
      await env.stop();
    }
  });
});
