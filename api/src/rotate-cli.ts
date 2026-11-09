import { pathToFileURL } from "node:url";
import { loadConfig, type Config } from "./config.js";
import { createPool, migrate, audit, type Db } from "./db.js";
import { buildSecretProvider, type SecretProvider } from "./secrets/provider.js";
import { createSourceSecrets } from "./secrets/source-secrets.js";
import { isEnvelope, type Envelope } from "./secrets/envelope.js";

// Re-encrypts every source credential with a new key id.
// One transaction per row. Audit rows hold counts only, never values or key material.

export type RotateResult = { rotated: number; skipped: number };

export type RotateOptions = {
  now?: () => Date;
  provider?: SecretProvider;
};

type Row = { id: number; config_secrets: Record<string, unknown> | null };

export async function rotateAll(db: Db, cfg: Config, toKid: string, opts: RotateOptions = {}): Promise<RotateResult> {
  const provider = opts.provider ?? buildSecretProvider(cfg);
  const secrets = createSourceSecrets(cfg, provider, { now: opts.now });
  const rows = (await db.query("SELECT id, config_secrets FROM sources ORDER BY id")).rows as Row[];

  let rotated = 0;
  let skipped = 0;

  for (const row of rows) {
    const stored = row.config_secrets ?? {};
    const entries = Object.entries(stored).filter(([, v]) => isEnvelope(v)) as [string, Envelope][];
    if (entries.length === 0) {
      skipped += 1;
      continue;
    }
    if (entries.every(([, env]) => env.kid === toKid)) {
      skipped += 1;
      continue;
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const next: Record<string, Envelope> = { ...(stored as Record<string, Envelope>) };
      for (const [name, env] of entries) {
        if (env.kid === toKid) continue;
        const plain = await secrets.decrypt(env);
        next[name] = await secrets.encrypt(plain, toKid);
      }
      await client.query("UPDATE sources SET config_secrets=$1 WHERE id=$2", [JSON.stringify(next), row.id]);
      await client.query("COMMIT");
      rotated += 1;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  await audit(db, {
    actor: "system",
    action: "secrets.rotated",
    target: `kid:${toKid}`,
    outcome: "ok",
    detail: { toKid, rotated, skipped },
  });

  return { rotated, skipped };
}

function parseArgs(argv: string[]): { toKid: string } {
  const i = argv.indexOf("--to");
  const toKid = i >= 0 ? argv[i + 1] : undefined;
  if (!toKid) throw new Error("usage: rotate --to <kid>");
  return { toKid };
}

async function main(): Promise<void> {
  const { toKid } = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const db = createPool(cfg.DATABASE_URL);
  try {
    await migrate(db);
    const result = await rotateAll(db, cfg, toKid);
    console.log(JSON.stringify({ msg: "rotation done", toKid, ...result }));
  } finally {
    await db.end();
  }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  main().catch((e) => {
    console.error(JSON.stringify({ level: "error", msg: "rotation failed", err: String(e) }));
    process.exit(1);
  });
}
