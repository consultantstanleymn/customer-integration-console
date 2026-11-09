import { authRoutes } from "./auth-routes.js";
import { routes, type Deps, type RouteDef } from "./routes.js";

/** Expected result of a call with no session, or with a session of a given role. */
export type Expectation = "allow" | "401" | "403";

export type MatrixRow = { anonymous: Expectation; viewer: Expectation; engineer: Expectation; admin: Expectation };

/**
 * Expected authorization matrix, keyed "METHOD /path".
 * "allow" means the call passed authz. A 2xx, 404 or 422 all count as passed authz.
 * A route without an entry here fails the matrix test.
 */
export const EXPECTED: Record<string, MatrixRow> = {
  "GET /auth/login": { anonymous: "allow", viewer: "allow", engineer: "allow", admin: "allow" },
  "GET /auth/callback": { anonymous: "allow", viewer: "allow", engineer: "allow", admin: "allow" },
  "POST /auth/logout": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },

  "GET /health": { anonymous: "allow", viewer: "allow", engineer: "allow", admin: "allow" },
  "GET /me": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },

  "GET /sources": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },
  "POST /sources": { anonymous: "401", viewer: "403", engineer: "allow", admin: "allow" },
  "DELETE /sources/:id": { anonymous: "401", viewer: "403", engineer: "403", admin: "allow" },
  "POST /sources/:id/run": { anonymous: "401", viewer: "403", engineer: "allow", admin: "allow" },
  "POST /sources/:id/upload": { anonymous: "401", viewer: "403", engineer: "allow", admin: "allow" },
  "POST /webhooks/:id": { anonymous: "allow", viewer: "allow", engineer: "allow", admin: "allow" },

  "GET /runs": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },
  "GET /runs/:id": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },
  "GET /stats": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },

  "GET /dead-letters": { anonymous: "401", viewer: "allow", engineer: "allow", admin: "allow" },
  "POST /dead-letters/:id/replay": { anonymous: "401", viewer: "403", engineer: "allow", admin: "allow" },
  "POST /dead-letters/:id/discard": { anonymous: "401", viewer: "403", engineer: "allow", admin: "allow" },

  "GET /audit": { anonymous: "401", viewer: "403", engineer: "403", admin: "allow" },
};

/** Key used by the matrix map and the test. */
export const keyOf = (r: Pick<RouteDef, "method" | "path">) => `${r.method} ${r.path}`;

/** Every route from the route table and the auth route table, in registration order. */
export function allRoutes(deps: Deps): RouteDef[] {
  return [...authRoutes(deps), ...routes(deps)];
}

/** Route keys that have no matrix entry. The matrix test fails when this list is not empty. */
export function missingEntries(defs: RouteDef[]): string[] {
  return defs.map(keyOf).filter((k) => !EXPECTED[k]);
}

/** Matrix entries that match no route. A stale entry is a sign the table drifted. */
export function staleEntries(defs: RouteDef[]): string[] {
  const keys = new Set(defs.map(keyOf));
  return Object.keys(EXPECTED).filter((k) => !keys.has(k));
}
