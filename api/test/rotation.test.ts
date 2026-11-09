import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createSourceSecrets } from "../src/secrets/source-secrets.js";
import { encryptField } from "../src/secrets/envelope.js";
import { rotateAll } from "../src/rotate-cli.js";
import { freshDb, type Env } from "./helpers.js";
import type { Db } from "../src/db.js";
import type { Config } from "../src/config.js";

const KIDS = ["k-old", "k-new"];
const saved: Record<string, string | undefined> = {};

function envName(kid: string): string {
  return `CIC_SECRET_SOURCE_KEK_${kid.toUpperCase().replace(/-/g, "_")}`;
}

function makeCfg(over: Partial<Config> = {}): Config {
  return {
    PORT: 4000,
    DATABASE_URL: "postgres://unused",
    OIDC_ISSUER: "http://localhost:4100",
    OIDC_INTERNAL_URL: undefined,
    OIDC_CLIENT_ID: "integration-console",
    OIDC_CLIENT_SECRET: "dev-only-secret",
    OIDC_DISCOVERY: "true",
    API_AUDIENCE: "cic-api",
    WEB_URL: "http://localhost:3000",
    COOKIE_SECURE: "false",
    SESSION_TTL_MINUTES: 480,
    LOG_LEVEL: "info",
    SECRET_BACKEND: "env",
    SECRET_DIR: undefined,
    GCP_PROJECT: undefined,
    SOURCE_KEK_ACTIVE: "k-new",
    SOURCE_KEK_PREVIOUS: ["k-old"],
    SOURCE_KEK_GRACE_UNTIL: undefined,
    oidcInternal: "http://localhost:4100",
    ...over,
  } as Config;
}

describe("source credential rotation", () => {
  let db: Db | undefined;

  beforeEach(async () => {
    for (const kid of KIDS) {
      const name = envName(kid);
      saved[name] = process.env[name];
      process.env[name] = randomBytes(32).toString("base64");
    }
    db = await freshDb();
  });

  afterEach(async () => {
    for (const kid of KIDS) {
      const name = envName(kid);
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await db?.end();
    db = undefined;
  });

  async function insertSource(secretKid: string, plain: string): Promise<number> {
    const kek = Buffer.from(process.env[envName(secretKid)]!, "base64");
    const env = encryptField(plain, kek, secretKid);
    const r = await db!.query(
      "INSERT INTO sources (name, type, config, config_secrets, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [`src-${secretKid}-${Math.random()}`, "rest", JSON.stringify({ baseUrl: "http://example.test" }), JSON.stringify({ apiKey: env }), "test"],
    );
    return r.rows[0].id as number;
  }

  it("old ciphertext decrypts during the grace window", async () => {
    const cfg = makeCfg({ SOURCE_KEK_GRACE_UNTIL: "2026-12-31T00:00:00Z" });
    const now = () => new Date("2026-11-09T00:00:00Z");
    const secrets = createSourceSecrets(cfg, undefined, { now });
    const kek = Buffer.from(process.env[envName("k-old")]!, "base64");
    const env = encryptField("top-secret", kek, "k-old");
    await expect(secrets.decrypt(env)).resolves.toBe("top-secret");
  });

  it("old ciphertext is refused after the grace window", async () => {
    const cfg = makeCfg({ SOURCE_KEK_GRACE_UNTIL: "2026-11-01T00:00:00Z" });
    const now = () => new Date("2026-11-09T00:00:00Z");
    const secrets = createSourceSecrets(cfg, undefined, { now });
    const kek = Buffer.from(process.env[envName("k-old")]!, "base64");
    const env = encryptField("top-secret", kek, "k-old");
    await expect(secrets.decrypt(env)).rejects.toThrow(/grace window ended/);
  });

  it("rotate re-encrypts every row to the new kid", async () => {
    const id1 = await insertSource("k-old", "alpha");
    const id2 = await insertSource("k-old", "beta");
    const cfg = makeCfg({ SOURCE_KEK_GRACE_UNTIL: "2026-12-31T00:00:00Z" });
    const now = () => new Date("2026-11-09T00:00:00Z");

    const result = await rotateAll(db!, cfg, "k-new", { now });
    expect(result.rotated).toBe(2);
    expect(result.skipped).toBe(0);

    const rows = (await db!.query("SELECT id, config_secrets FROM sources WHERE id = ANY($1) ORDER BY id", [[id1, id2]])).rows;
    for (const row of rows) {
      expect(row.config_secrets.apiKey.kid).toBe("k-new");
    }

    const secrets = createSourceSecrets(cfg, undefined, { now });
    const first = rows[0];
    await expect(secrets.decrypt(first.config_secrets.apiKey)).resolves.toBe("alpha");
    const second = rows[1];
    await expect(secrets.decrypt(second.config_secrets.apiKey)).resolves.toBe("beta");

    const auditRows = (await db!.query("SELECT actor, action, detail FROM audit_log WHERE action='secrets.rotated'")).rows;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].actor).toBe("system");
    expect(auditRows[0].detail).toEqual({ toKid: "k-new", rotated: 2, skipped: 0 });
    expect(JSON.stringify(auditRows[0].detail)).not.toContain("alpha");
    expect(JSON.stringify(auditRows[0].detail)).not.toContain("beta");
  });

  it("rotate is safe to run twice", async () => {
    await insertSource("k-old", "alpha");
    const cfg = makeCfg({ SOURCE_KEK_GRACE_UNTIL: "2026-12-31T00:00:00Z" });
    const now = () => new Date("2026-11-09T00:00:00Z");

    const first = await rotateAll(db!, cfg, "k-new", { now });
    expect(first.rotated).toBe(1);
    const second = await rotateAll(db!, cfg, "k-new", { now });
    expect(second.rotated).toBe(0);
    expect(second.skipped).toBe(1);
  });
});

// Keep the unused import warning away when helpers change.
export type _Env = Env;
