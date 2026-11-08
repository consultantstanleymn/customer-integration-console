import { describe, expect, it } from "vitest";
import { OrderIn, CreateSource } from "../src/schemas.js";
import { qualityChecks, qualityScore } from "../src/quality.js";
import { canAccess, roleFromClaims, pkceChallenge, safeEqual } from "../src/auth.js";
import { extractCsv, extractRest, signBody, verifySignature } from "../src/pipeline/extract.js";
import { maxWatermark } from "../src/pipeline/run.js";
import { buildOpenApi } from "../src/openapi.js";
import { routes, type Deps } from "../src/routes.js";
import { loadConfig } from "../src/config.js";
import { authRoutes } from "../src/auth-routes.js";
import { createSource, makeOrders } from "../../mocks/src/source.js";
import type { AddressInfo } from "node:net";

const good = { external_id: "X1", customer_email: "a@b.co", amount: "12.5", currency: "usd", status: "paid", updated_at: "2026-01-01T00:00:00Z" };

describe("OrderIn validation", () => {
  it("accepts a good row and normalises the date", () => {
    const r = OrderIn.parse(good);
    expect(r.amount).toBe(12.5);
    expect(r.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });
  it.each([
    ["bad email", { customer_email: "nope" }],
    ["negative amount", { amount: -1 }],
    ["text amount", { amount: "abc" }],
    ["2 letter currency", { currency: "US" }],
    ["bad date", { updated_at: "yesterday" }],
    ["empty id", { external_id: "  " }],
    ["huge amount", { amount: 1e15 }],
  ])("rejects %s", (_n, patch) => {
    expect(OrderIn.safeParse({ ...good, ...patch }).success).toBe(false);
  });
  it("rest sources need a base url", () => {
    expect(CreateSource.safeParse({ name: "abc", type: "rest" }).success).toBe(false);
    expect(CreateSource.safeParse({ name: "abc", type: "rest", config: { baseUrl: "http://x.test" } }).success).toBe(true);
  });
});

describe("quality checks", () => {
  const by = (rows: Record<string, unknown>[], failed = 0) => Object.fromEntries(qualityChecks(rows, failed).map((r) => [r.name, r]));
  it("passes on clean data", () => {
    const r = by([good, { ...good, external_id: "X2" }]);
    expect(Object.values(r).every((x) => x.passed)).toBe(true);
    expect(qualityScore(Object.values(r))).toBe(1);
  });
  it("finds nulls", () => {
    const r = by([{ ...good, customer_email: "" }]);
    expect(r.null_check!.passed).toBe(false);
    expect(r.null_check!.detail).toContain("customer_email: 1 empty");
  });
  it("finds duplicate keys", () => {
    expect(by([good, good]).duplicate_keys!.passed).toBe(false);
  });
  it("finds schema drift: missing and unexpected columns", () => {
    const noAmount: Record<string, unknown> = { ...good };
    delete noAmount.amount;
    const r = by([{ ...noAmount, discount: 1 }]);
    expect(r.schema_drift!.passed).toBe(false);
    expect(r.schema_drift!.detail).toContain("missing: [amount]");
    expect(r.schema_drift!.detail).toContain("unexpected: [discount]");
  });
  it("fails validation_rate under 90 percent", () => {
    expect(by([good, good, good, good], 1).validation_rate!.passed).toBe(false);
  });
  it("handles an empty batch", () => {
    expect(Object.values(by([])).every((x) => x.passed)).toBe(true);
  });
});

describe("auth helpers", () => {
  it("ranks roles", () => {
    expect(canAccess("admin", "engineer")).toBe(true);
    expect(canAccess("viewer", "engineer")).toBe(false);
    expect(canAccess("engineer", "admin")).toBe(false);
    expect(canAccess("viewer", "viewer")).toBe(true);
  });
  it("takes the highest known role and ignores unknown ones", () => {
    expect(roleFromClaims(["viewer", "admin"])).toBe("admin");
    expect(roleFromClaims(["superuser"])).toBeNull();
    expect(roleFromClaims(undefined)).toBeNull();
  });
  it("computes the RFC 7636 PKCE example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("accepts the right signature only", () => {
    const sig = signBody("s3cret", '{"a":1}');
    expect(verifySignature("s3cret", '{"a":1}', sig)).toBe(true);
    expect(verifySignature("s3cret", '{"a":2}', sig)).toBe(false);
    expect(verifySignature("other", '{"a":1}', sig)).toBe(false);
    expect(verifySignature("s3cret", '{"a":1}', undefined)).toBe(false);
  });
});

describe("extract", () => {
  it("parses csv and keeps empty cells", () => {
    const rows = extractCsv("a,b\n1,\n2,x\n");
    expect(rows).toEqual([{ a: "1", b: "" }, { a: "2", b: "x" }]);
  });
  it("keeps the later watermark", () => {
    expect(maxWatermark(null, "2026-01-01")).toBe("2026-01-01");
    expect(maxWatermark("2026-02-01", "2026-01-01")).toBe("2026-02-01");
    expect(maxWatermark(null, null)).toBeNull();
  });
  it("pages through the REST source and retries after a 429", async () => {
    const srv = createSource({ rateLimit: 1, windowMs: 100, orders: makeOrders(120) });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    let sleeps = 0;
    const rows = await extractRest({ baseUrl: base, apiKey: "demo-key" }, null, { sleep: async () => { sleeps++; await new Promise((r) => setTimeout(r, 120)); } });
    srv.close();
    expect(rows).toHaveLength(120);
    expect(sleeps).toBeGreaterThan(0);
  });
  it("sends only rows newer than the watermark", async () => {
    const srv = createSource({ rateLimit: 100 });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const all = makeOrders(120);
    const rows = await extractRest({ baseUrl: base, apiKey: "demo-key" }, String(all[99]!.updated_at));
    srv.close();
    expect(rows).toHaveLength(20);
  });
  it("fails clearly on a bad api key", async () => {
    const srv = createSource();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    await expect(extractRest({ baseUrl: base, apiKey: "wrong" }, null)).rejects.toThrow("HTTP 401");
    srv.close();
  });
});

describe("OpenAPI", () => {
  const stub = { cfg: loadConfig({}) } as Deps;
  const defs = [...authRoutes(stub), ...routes(stub)];
  const doc = buildOpenApi(defs);
  it("documents every route", () => {
    for (const d of defs) expect(doc.paths[d.path.replace(/:(\w+)/g, "{$1}")]?.[d.method.toLowerCase()]).toBeDefined();
  });
  it("has unique operation ids and marks roles", () => {
    const ids = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => (o as { operationId: string }).operationId));
    expect(new Set(ids).size).toBe(ids.length);
    expect((doc.paths["/sources/{id}"]!.delete as Record<string, unknown>)["x-minimum-role"]).toBe("admin");
  });
  it("has no duplicate method+path in the route table", () => {
    const keys = defs.map((d) => `${d.method} ${d.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
