// A tiny OpenID Connect provider for local use. It implements the authorization code flow with PKCE
// and signs ID tokens with RS256. NOT for production: it has no passwords and keeps state in memory.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { fileURLToPath } from "node:url";

export const USERS = [
  { sub: "u-alice", name: "Alice Admin", email: "alice@example.test", roles: ["admin"] },
  { sub: "u-bob", name: "Bob Engineer", email: "bob@example.test", roles: ["engineer"] },
  { sub: "u-carol", name: "Carol Viewer", email: "carol@example.test", roles: ["viewer"] },
];

type Pending = { clientId: string; redirectUri: string; nonce: string; challenge: string; sub: string; exp: number };

export async function createOidc(cfg: { issuer: string; clientId: string; clientSecret: string }): Promise<Server> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" };
  const codes = new Map<string, Pending>();

  const readForm = async (req: IncomingMessage) => {
    let s = "";
    for await (const c of req) s += c;
    return new URLSearchParams(s);
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", cfg.issuer);
    const send = (code: number, body: string, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(body); };

    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, JSON.stringify({
        issuer: cfg.issuer, authorization_endpoint: `${cfg.issuer}/authorize`, token_endpoint: `${cfg.issuer}/token`,
        jwks_uri: `${cfg.issuer}/jwks`, response_types_supported: ["code"], id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      }));
    }
    if (url.pathname === "/jwks") return send(200, JSON.stringify({ keys: [jwk] }));

    // Step 1: the browser arrives here. We show a user picker instead of a password form.
    if (url.pathname === "/authorize" && req.method === "GET") {
      const q = url.searchParams;
      if (q.get("client_id") !== cfg.clientId || !q.get("redirect_uri") || q.get("response_type") !== "code" || !q.get("code_challenge")) {
        return send(400, "bad authorization request", "text/plain");
      }
      const hidden = ["client_id", "redirect_uri", "state", "nonce", "code_challenge"].map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k) ?? "")}">`).join("");
      const buttons = USERS.map((u) => `<button name="sub" value="${u.sub}" data-user="${u.email}">${esc(u.name)} <small>(${u.roles[0]})</small></button>`).join("");
      return send(200, `<!doctype html><meta charset=utf-8><title>Mock sign-in</title><body style="font:16px system-ui;max-width:420px;margin:12vh auto"><h1>Mock identity provider</h1><p>Pick a test user. No password. Local use only.</p><form method="post" action="/authorize" style="display:grid;gap:8px">${hidden}${buttons}</form></body>`, "text/html");
    }
    // Step 2: user chosen. Issue a one-time code and send the browser back.
    if (url.pathname === "/authorize" && req.method === "POST") {
      const f = await readForm(req);
      const code = randomBytes(16).toString("hex");
      codes.set(code, { clientId: f.get("client_id") ?? "", redirectUri: f.get("redirect_uri") ?? "", nonce: f.get("nonce") ?? "", challenge: f.get("code_challenge") ?? "", sub: f.get("sub") ?? "", exp: Date.now() + 60_000 });
      const back = new URL(f.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", f.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    // Step 3: the API swaps the code (plus the PKCE verifier) for tokens.
    if (url.pathname === "/token" && req.method === "POST") {
      const f = await readForm(req);
      const p = codes.get(f.get("code") ?? "");
      codes.delete(f.get("code") ?? ""); // one use only
      const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
      const ok = p && p.exp > Date.now() && p.clientId === f.get("client_id") && p.redirectUri === f.get("redirect_uri")
        && f.get("client_secret") === cfg.clientSecret && challenge === p.challenge;
      if (!p || !ok) return send(400, JSON.stringify({ error: "invalid_grant" }));
      const user = USERS.find((u) => u.sub === p.sub);
      if (!user) return send(400, JSON.stringify({ error: "invalid_grant" }));
      const idToken = await new SignJWT({ name: user.name, email: user.email, roles: user.roles, nonce: p.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "mock-1" }).setIssuer(cfg.issuer).setAudience(cfg.clientId)
        .setSubject(user.sub).setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return send(200, JSON.stringify({ id_token: idToken, access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 300 }));
    }
    send(404, "not found", "text/plain");
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4100);
  const server = await createOidc({
    issuer: process.env.OIDC_ISSUER ?? `http://localhost:${port}`,
    clientId: process.env.OIDC_CLIENT_ID ?? "integration-console",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "dev-only-secret",
  });
  server.listen(port, () => console.log(`mock-oidc on :${port}`));
}
