import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptField, decryptField } from "../src/secrets/envelope.js";
import { signBody } from "../src/pipeline/extract.js";
import { migratePlainSecrets } from "../../scripts/migrate-plain-secrets.js";
import { startEnv, goodCsv, type Env } from "./helpers.js";

const KEK = randomBytes(32);
const KEYRING = new Map([["k1", KEK]]);

describe("envelope encryption", () => {
  it("round trip", () => {
    const env = encryptField("hello world", KEK, "k1");
    expect(env.v).toBe(1);
    expect(env.kid).toBe("k1");
    expect(env.ct).not.toContain("hello");
    expect(decryptField(env, KEYRING)).toBe("hello world");
  });

  it("tampered ciphertext fails", () => {
    const env = encryptField("hello world", KEK, "k1");
    const raw = Buffer.from(env.ct, "base64");
    raw[0] = raw[0]! ^ 0xff;
    const bad = { ...env, ct: raw.toString("base64") };
    expect(() => decryptField(bad, KEYRING)).toThrow();
  });

  it("wrong key id fails", () => {
    const env = encryptField("hello world", KEK, "k1");
    expect(() => decryptField(env, new Map([["other", KEK]]))).toThrow(/unknown key id/);
  });
});

describe("source credentials", () => {
  let env: Env | undefined;
  afterEach(async () => { await env?.stop(); env = undefined; });

  it("created webhook source stores no plain secret", async () => {
    env = await startEnv();
    const admin = await env.login("u-bob");
    const created = await env.call(admin, "POST", "/sources", { name: "hook", type: "webhook", config: {} });
    expect(created.status).toBe(201);
    const secret = (created.body as { webhookSecret: string }).webhookSecret;
    expect(typeof secret).toBe("string");

    const row = (await env.db.query("SELECT config, config_secrets FROM sources WHERE id=$1", [(created.body as { id: number }).id])).rows[0];
    expect(row.config.secret).toBeUndefined();
    expect(row.config.apiKey).toBeUndefined();
    expect(JSON.stringify(row.config)).not.toContain(secret);
    expect(row.config_secrets.secret.v).toBe(1);
    expect(row.config_secrets.secret.kid).toBe(env.cfg.SOURCE_KEK_ACTIVE);

    const list = await env.call(admin, "GET", "/sources");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain("config_secrets");
  });

  it("REST source still pulls with the encrypted api key", async () => {
    env = await startEnv();
    const admin = await env.login("u-bob");
    const created = await env.call(admin, "POST", "/sources", { name: "rest", type: "rest", config: { baseUrl: env.sourceUrl, apiKey: "demo-key" } });
    expect(created.status).toBe(201);
    const row = (await env.db.query("SELECT config, config_secrets FROM sources WHERE id=$1", [(created.body as { id: number }).id])).rows[0];
    expect(row.config.apiKey).toBeUndefined();
    expect(row.config_secrets.apiKey.v).toBe(1);

    const run = await env.call(admin, "POST", `/sources/${(created.body as { id: number }).id}/run`);
    expect(run.status).toBe(200);
    expect((run.body as { status: string }).status).toBe("success");
    expect((run.body as { rowsLoaded: number }).rowsLoaded).toBeGreaterThan(0);
  });

  it("webhook signature still verifies", async () => {
    env = await startEnv();
    const admin = await env.login("u-bob");
    const created = await env.call(admin, "POST", "/sources", { name: "hook", type: "webhook", config: {} });
    expect(created.status).toBe(201);
    const id = (created.body as { id: number }).id;
    const secret = (created.body as { webhookSecret: string }).webhookSecret;

    const body = JSON.stringify({ external_id: "W-1", customer_email: "w@example.com", amount: 1, currency: "USD", status: "paid", updated_at: "2026-02-01T10:00:00Z" });
    const bad = await env.call(null, "POST", `/webhooks/${id}`, body, { "content-type": "application/json", "x-signature": "sha256=deadbeef" });
    expect(bad.status).toBe(401);
    const ok = await env.call(null, "POST", `/webhooks/${id}`, body, { "content-type": "application/json", "x-signature": signBody(secret, body) });
    expect(ok.status).toBe(202);
  });

  it("plain-secret migration is idempotent", async () => {
    env = await startEnv();
    const admin = await env.login("u-bob");
    const created = await env.call(admin, "POST", "/sources", { name: "legacy", type: "rest", config: { baseUrl: env.sourceUrl } });
    expect(created.status).toBe(201);
    const id = (created.body as { id: number }).id;
    // Simulate a row from before migration 002.
    await env.db.query("UPDATE sources SET config=$1, config_secrets='{}'::jsonb WHERE id=$2", [JSON.stringify({ baseUrl: env.sourceUrl, apiKey: "demo-key" }), id]);

    const first = await migratePlainSecrets(env.db, env.cfg);
    expect(first.migrated).toBe(1);
    const row = (await env.db.query("SELECT config, config_secrets FROM sources WHERE id=$1", [id])).rows[0];
    expect(row.config.apiKey).toBeUndefined();
    expect(row.config_secrets.apiKey.v).toBe(1);

    const second = await migratePlainSecrets(env.db, env.cfg);
    expect(second.migrated).toBe(0);

    const run = await env.call(admin, "POST", `/sources/${id}/run`);
    expect(run.status).toBe(200);
    expect((run.body as { status: string }).status).toBe("success");
  });

  it("csv upload still works", async () => {
    env = await startEnv();
    const admin = await env.login("u-bob");
    const created = await env.call(admin, "POST", "/sources", { name: "csv", type: "csv", config: {} });
    expect(created.status).toBe(201);
    const up = await env.call(admin, "POST", `/sources/${(created.body as { id: number }).id}/upload`, goodCsv);
    expect(up.status).toBe(200);
    expect((up.body as { status: string }).status).toBe("success");
  });
});
