import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { audit, type Db } from "./db.js";
import type { Config } from "./config.js";
import { createLogger } from "./logger.js";
import { createMetrics } from "./metrics.js";
import { canAccess, loadSession, safeEqual, scopesOf, verifyBearer, type Session } from "./auth.js";
import { authRoutes } from "./auth-routes.js";
import { HttpError, routes } from "./routes.js";
import { buildOpenApi } from "./openapi.js";
import { issuesOf } from "./schemas.js";
import { createLoginLimiter } from "./login-limit.js";

declare module "fastify" {
  interface FastifyRequest { rawBody?: string; session?: Session }
}

const LOGIN_PATHS = new Set(["/auth/login", "/auth/callback"]);

export async function buildApp(db: Db, cfg: Config) {
  const metrics = createMetrics();
  const app = Fastify({ loggerInstance: createLogger(cfg.LOG_LEVEL), bodyLimit: 5 * 1024 * 1024 });
  await app.register(cookie);

  // JSON bodies keep their raw text too (webhook signatures are computed over the raw bytes).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch { done(new HttpError(400, "invalid JSON"), undefined); }
  });
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => done(null, body));

  const deps = { db, cfg, metrics };
  const defs = [...authRoutes(deps), ...routes(deps)];
  const loginLimiter = createLoginLimiter({ perMinute: cfg.LOGIN_RATE_PER_MIN });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    const hasCredential = Boolean(req.cookies?.sid) || String(req.headers.authorization ?? "").startsWith("Bearer ");
    if (hasCredential) reply.header("Cache-Control", "no-store");
    const ct = String(reply.getHeader("content-type") ?? "");
    if (ct.includes("application/json")) reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });

  app.addHook("onResponse", async (req, reply) => {
    metrics.http.observe({ method: req.method, route: req.routeOptions.url ?? "unmatched", status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...(err.extra as object | undefined) });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal error" });
  });

  for (const r of defs) {
    app.route({
      method: r.method,
      url: r.path,
      handler: async (req, reply) => {
        if (LOGIN_PATHS.has(r.path)) {
          const ip = req.ip;
          const gate = loginLimiter.take(ip);
          if (!gate.ok) {
            await audit(db, { actor: "anonymous", action: "auth.rate_limited", target: `${r.method} ${r.path}`, outcome: "denied", detail: { ip } });
            metrics.authEvents.inc({ event: "rate_limited" });
            reply.header("Retry-After", String(Math.max(1, Math.ceil(gate.retryAfterSec))));
            return reply.code(429).send({ error: "too many login attempts" });
          }
        }
        if (r.auth !== "public") {
          const s = await loadSession(db, req.cookies.sid);
          if (s) {
            if (!canAccess(s.role, r.auth)) {
              await audit(db, { actor: s.email, role: s.role, action: "access.denied", target: `${r.method} ${r.path}`, outcome: "denied" });
              metrics.authEvents.inc({ event: "forbidden" });
              throw new HttpError(403, `requires role ${r.auth}`);
            }
            // CSRF: state-changing calls must echo the token that only our own pages can read via /me.
            if (r.method !== "GET" && !safeEqual(String(req.headers["x-csrf-token"] ?? ""), s.csrf)) {
              await audit(db, { actor: s.email, role: s.role, action: "csrf.rejected", target: `${r.method} ${r.path}`, outcome: "denied" });
              throw new HttpError(403, "missing or wrong CSRF token");
            }
            req.session = s;
          } else {
            const header = String(req.headers.authorization ?? "");
            if (!header.startsWith("Bearer ")) throw new HttpError(401, "sign in required");
            let payload: { sub?: unknown; scope?: unknown };
            try {
              payload = await verifyBearer(cfg, header.slice("Bearer ".length).trim());
            } catch {
              metrics.authEvents.inc({ event: "bearer_invalid" });
              throw new HttpError(401, "invalid or expired token");
            }
            const sub = String(payload.sub ?? "");
            const actor = `client:${sub}`;
            const need = r.scopes ?? [];
            const have = scopesOf(payload);
            if (need.length === 0 || !need.every((x) => have.includes(x))) {
              await audit(db, { actor, role: "machine", action: "access.denied", target: `${r.method} ${r.path}`, outcome: "denied", detail: { need, have } });
              metrics.authEvents.inc({ event: "forbidden" });
              throw new HttpError(403, "token lacks the required scope");
            }
            // Machine calls carry no cookie, so they skip CSRF. The role check is replaced by the scope check.
            req.session = { id: "machine", email: actor, name: sub, role: "viewer", csrf: "", machine: true };
          }
        }
        let body = req.body;
        if (r.body) {
          const parsed = r.body.safeParse(body ?? {});
          if (!parsed.success) throw new HttpError(400, "validation failed", { issues: issuesOf(parsed.error) });
          body = parsed.data;
        }
        const out = await r.handler({ req, reply, body, query: req.query as Record<string, string>, params: req.params as Record<string, string> });
        return out === reply ? reply : out;
      },
    });
  }

  app.get("/metrics", async (_req, reply) => reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()));
  const openapi = buildOpenApi(defs);
  app.get("/openapi.json", async () => openapi);

  return app;
}
