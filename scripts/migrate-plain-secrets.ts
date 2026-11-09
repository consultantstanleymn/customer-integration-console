// One-time move of plain source credentials into encrypted config_secrets.
// Safe to run many times. Each row is handled in its own transaction.
import { pathToFileURL } from "node:url";
import { createPool, type Db } from "../api/src/db.js";
import { loadConfig, type Config } from "../api/src/config.js";
import { createSourceSecrets } from "../api/src/secrets/source-secrets.js";

export type MigrateResult = { scanned: number; migrated: number; skipped: number };

const PLAIN_KEYS = ["secret", "apiKey"] as const;

function hasPlain(config: Record<string, string>): boolean {
  return PLAIN_KEYS.some((k) => typeof config[k] === "string");
}

function hasSecrets(configSecrets: unknown): boolean {
  return !!configSecrets && typeof configSecrets === "object" && Object.keys(configSecrets as Record<string, unknown>).length > 0;
}

export async function migratePlainSecrets(db: Db, cfg: Config): Promise<MigrateResult> {
  const secrets = createSourceSecrets(cfg);
  const { rows } = await db.query("SELECT id, config, config_secrets FROM sources ORDER BY id");
  const result: MigrateResult = { scanned: rows.length, migrated: 0, skipped: 0 };
  for (const row of rows) {
    const config = (row.config ?? {}) as Record<string, string>;
    if (!hasPlain(config) || hasSecrets(row.config_secrets)) {
      result.skipped++;
      continue;
    }
    const enc = await secrets.encryptInto(config);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE sources SET config=$1, config_secrets=$2 WHERE id=$3", [JSON.stringify(enc.config), JSON.stringify(enc.secrets), row.id]);
      await client.query("COMMIT");
      result.migrated++;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return result;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const cfg = loadConfig();
  const db = createPool(cfg.DATABASE_URL);
  try {
    const r = await migratePlainSecrets(db, cfg);
    console.log(JSON.stringify(r));
  } finally {
    await db.end();
  }
}
