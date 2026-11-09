import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createPool, type Db } from "./db.js";
import { verifyChain, type AuditRow, type VerifyResult } from "./audit-chain.js";

const COLUMNS = "id, at, actor, role, action, target, outcome, detail, prev_hash, row_hash";

function toRow(r: Record<string, unknown>): AuditRow {
  const at = r.at instanceof Date ? r.at.toISOString() : new Date(r.at as string).toISOString();
  return {
    id: r.id as number,
    at,
    actor: r.actor as string,
    role: (r.role ?? null) as string | null,
    action: r.action as string,
    target: (r.target ?? null) as string | null,
    outcome: r.outcome as string,
    detail: r.detail,
    prev_hash: (r.prev_hash ?? null) as string | null,
    row_hash: (r.row_hash ?? null) as string | null,
  };
}

/** Writes all audit rows as JSON lines, ordered by id. */
export async function exportAudit(db: Db, outPath: string): Promise<number> {
  const r = await db.query(`SELECT ${COLUMNS} FROM audit_log ORDER BY id`);
  const lines = r.rows.map((row) => JSON.stringify(toRow(row as Record<string, unknown>)));
  writeFileSync(outPath, lines.length > 0 ? lines.join("\n") + "\n" : "", "utf8");
  return lines.length;
}

/** Reads a JSONL file and checks the hash chain. */
export function verifyFile(path: string): VerifyResult {
  const text = readFileSync(path, "utf8");
  const rows: AuditRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    rows.push(toRow(JSON.parse(line) as Record<string, unknown>));
  }
  return verifyChain(rows);
}

/** Reads the audit table and checks the hash chain. */
export async function verifyDb(db: Db): Promise<VerifyResult> {
  const r = await db.query(`SELECT ${COLUMNS} FROM audit_log ORDER BY id`);
  return verifyChain(r.rows.map((row) => toRow(row as Record<string, unknown>)));
}

function usage(): never {
  console.error("usage: audit-cli export --out <file.jsonl> | verify --in <file.jsonl> | verify --db");
  process.exit(2);
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === "export") {
    const out = argValue(rest, "--out");
    if (!out) usage();
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error("DATABASE_URL is not set");
      process.exit(2);
    }
    const db = createPool(url);
    try {
      const n = await exportAudit(db, out);
      console.log(`exported ${n} rows to ${out}`);
    } finally {
      await db.end();
    }
    return;
  }
  if (cmd === "verify") {
    let result: VerifyResult;
    if (rest.includes("--db")) {
      const url = process.env.DATABASE_URL;
      if (!url) {
        console.error("DATABASE_URL is not set");
        process.exit(2);
      }
      const db = createPool(url);
      try {
        result = await verifyDb(db);
      } finally {
        await db.end();
      }
    } else {
      const input = argValue(rest, "--in");
      if (!input) usage();
      result = verifyFile(input);
    }
    if (result.ok) {
      console.log(`OK ${result.unchained} unchained, chain valid`);
      process.exit(0);
    }
    console.log(`BAD first bad id ${result.firstBadId}`);
    process.exit(1);
  }
  usage();
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
