import { audit } from "./db.js";
import { authorizeUrl, createSession, deleteSession, exchangeCode, newToken, roleFromClaims, safeEqual } from "./auth.js";
import { HttpError, type Deps, type RouteDef } from "./routes.js";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, path: "/" };

/** Login, callback and logout. These sit in the same table as every other route. */
export function authRoutes({ db, cfg, metrics }: Deps): RouteDef[] {
  const secure = cfg.COOKIE_SECURE === "true";
  const redirectUri = `${cfg.WEB_URL}/api/auth/callback`;

  return [
    {
      method: "GET", path: "/auth/login", summary: "Start single sign-on (redirects to the identity provider)", auth: "public",
      handler: async (c) => {
        const tx = { state: newToken(16), nonce: newToken(16), verifier: newToken(32) };
        c.reply.setCookie("oidc_tx", Buffer.from(JSON.stringify(tx)).toString("base64url"), { ...COOKIE, secure, path: "/", maxAge: 600 });
        return c.reply.redirect(authorizeUrl(cfg, redirectUri, tx));
      },
    },
    {
      method: "GET", path: "/auth/callback", summary: "Finish single sign-on, create the session", auth: "public",
      handler: async (c) => {
        const raw = c.req.cookies.oidc_tx;
        const { code, state } = c.query;
        c.reply.clearCookie("oidc_tx", { path: "/" });
        let tx: { state: string; nonce: string; verifier: string };
        try { tx = JSON.parse(Buffer.from(raw ?? "", "base64url").toString()); } catch { throw new HttpError(400, "missing login state"); }
        if (!code || !state || !safeEqual(state, tx.state)) throw new HttpError(400, "state mismatch");
        let claims;
        try { claims = await exchangeCode(cfg, code, redirectUri, tx.verifier, tx.nonce); } catch (e) {
          await audit(db, { actor: "unknown", action: "auth.login", outcome: "error", detail: { reason: String(e) } });
          metrics.authEvents.inc({ event: "login_failed" });
          throw new HttpError(401, "login failed");
        }
        const email = String(claims.email ?? "");
        const role = roleFromClaims(claims.roles);
        if (!email || !role) {
          await audit(db, { actor: email || "unknown", action: "auth.login", outcome: "denied", detail: { reason: "no known role" } });
          throw new HttpError(403, "your account has no role for this console");
        }
        const s = await createSession(db, cfg, { email, name: String(claims.name ?? email), role });
        c.reply.setCookie("sid", s.id, { ...COOKIE, secure, maxAge: cfg.SESSION_TTL_MINUTES * 60 });
        await audit(db, { actor: email, role, action: "auth.login" });
        metrics.authEvents.inc({ event: "login_ok" });
        return c.reply.redirect(`${cfg.WEB_URL}/`);
      },
    },
    {
      method: "POST", path: "/auth/logout", summary: "End the session", auth: "viewer",
      handler: async (c) => {
        const s = c.req.session!;
        await deleteSession(db, s.id);
        c.reply.clearCookie("sid", { path: "/" });
        await audit(db, { actor: s.email, role: s.role, action: "auth.logout" });
        return { ok: true };
      },
    },
  ];
}
