import { loadConfig } from "../src/config.js";
import { describe, expect, it } from "vitest";
import { startEnv, type Env } from "./helpers.js";
import { allRoutes, EXPECTED, keyOf, missingEntries, renderMatrixMarkdown, staleEntries, type Expectation } from "../src/authz-expected.js";
import type { RouteDef } from "../src/routes.js";

type Role = "anonymous" | "viewer" | "engineer" | "admin";

const SUBS = { viewer: "u-carol", engineer: "u-bob", admin: "u-alice" } as const;
const ROLES: Role[] = ["anonymous", "viewer", "engineer", "admin"];

/** Minimal valid bodies for routes that read a body. Keys are "METHOD /path". */
const sampleBodies: Record<string, unknown> = {
  "POST /sources": { name: "matrix source", type: "csv", config: {} },
  "POST /sources/:id/upload": "external_id,customer_email,amount,currency,status,updated_at\n",
  "POST /webhooks/:id": { external_id: "M-1", customer_email: "m@example.com", amount: 1, currency: "USD", status: "paid", updated_at: "2026-02-01T10:00:00Z" },
  "POST /dead-letters/:id/replay": {},
  "POST /dead-letters/:id/discard": {},
};

const concrete = (path: string) => path.replace(":id", "1");

/** Classifies a status code into the matrix vocabulary. */
function classify(status: number): Expectation {
  if (status === 401) return "401";
  if (status === 403) return "403";
  if (status >= 200 && status < 500) return "allow";
  return "allow";
}

// The route tables only build closures here. Requests go through the real app below.
const defs: RouteDef[] = allRoutes({ db: {} as never, cfg: loadConfig({ DATABASE_URL: "postgres://unused" }), metrics: {} as never });

describe("authz matrix", () => {
  let env: Env;
  let who: Record<Role, Awaited<ReturnType<Env["login"]>> | null>;
  let machine: string;

  it("prepares the environment", async () => {
    env = await startEnv();
    who = {
      anonymous: null,
      viewer: await env.login("u-carol"),
      engineer: await env.login("u-bob"),
      admin: await env.login("u-alice"),
    };
    machine = await env.machineToken("runs:start sources:read");
    expect(defs.length).toBeGreaterThan(0);
  });

  const cases: Array<[string, Role]> = [];
  for (const r of defs) {
    for (const role of ROLES) cases.push([keyOf(r), role]);
  }

  it.each(cases)("authz matrix: %s as %s", async (key, role) => {
    const def = defs.find((d) => keyOf(d) === key);
    expect(def, `route ${key} not found`).toBeTruthy();
    const expected = EXPECTED[key];
    expect(expected, `route ${key} has no matrix entry`).toBeTruthy();
    const body = sampleBodies[key];
    // Logout destroys the session, so it gets a fresh login and the shared sessions stay valid.
    const actor = key === "POST /auth/logout" && who[role] ? await env.login(SUBS[role as Exclude<Role, "anonymous">]) : who[role];
    const res = await env.call(actor, def!.method as "GET" | "POST" | "DELETE", concrete(def!.path), body);
    expect(classify(res.status), `${key} as ${role} returned ${res.status}: ${res.raw}`).toBe(expected![role]);
  });

  const machineCases: string[] = defs.filter((d) => EXPECTED[keyOf(d)]?.machine).map(keyOf);

  it.each(machineCases)("authz matrix: %s as machine", async (key) => {
    const def = defs.find((d) => keyOf(d) === key)!;
    const expected = EXPECTED[key]!.machine!;
    const res = await env.call(null, def.method as "GET" | "POST" | "DELETE", concrete(def.path), sampleBodies[key], { authorization: `Bearer ${machine}` });
    expect(classify(res.status), `${key} as machine returned ${res.status}: ${res.raw}`).toBe(expected);
  });

  it("every route has an expected entry", () => {
    const missing = missingEntries(defs);
    expect(missing, `unmapped routes:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no expected entry without a route", () => {
    const stale = staleEntries(defs);
    expect(stale, `stale entries:\n${stale.join("\n")}`).toEqual([]);
  });

  it("matrix markdown is current", async () => {
    const { readFile } = await import("node:fs/promises");
    const committed = await readFile(new URL("../../docs/engagement/evidence/authz-matrix.md", import.meta.url), "utf8");
    expect(renderMatrixMarkdown(defs).trim()).toBe(committed.trim());
  });
});
