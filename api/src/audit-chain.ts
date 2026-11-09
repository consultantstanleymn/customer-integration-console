/** Canonical JSON: sorted keys, no spaces, stable output. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
  }
  return "null";
}

export type AuditFields = {
  at: string;
  actor: string;
  role: string | null;
  action: string;
  target: string | null;
  outcome: string;
  detail: unknown;
};

/** sha256 hex of (prevHash + canonicalJson(fields)). */
export function computeRowHash(prevHash: string, fields: AuditFields): string {
  const payload = prevHash + canonicalJson(fields);
  return sha256Hex(payload);
}

import { createHash } from "node:crypto";
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export type AuditRow = {
  id: number | string;
  at: Date | string;
  actor: string;
  role: string | null;
  action: string;
  target: string | null;
  outcome: string;
  detail: unknown;
  prev_hash: string | null;
  row_hash: string | null;
};

export type VerifyResult = { ok: boolean; firstBadId: number | null; unchained: number };

/** Checks the hash chain. Rows without row_hash are unchained and only allowed before the first chained row. */
export function verifyChain(rows: AuditRow[]): VerifyResult {
  const sorted = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  let prev: string | null = null;
  let seenChained = false;
  let unchained = 0;
  for (const row of sorted) {
    if (row.row_hash === null || row.row_hash === undefined) {
      if (seenChained) return { ok: false, firstBadId: Number(row.id), unchained };
      unchained++;
      continue;
    }
    seenChained = true;
    const expectedPrev = prev ?? "";
    if ((row.prev_hash ?? "") !== expectedPrev) return { ok: false, firstBadId: Number(row.id), unchained };
    const at = row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString();
    const fields: AuditFields = {
      at,
      actor: row.actor,
      role: row.role,
      action: row.action,
      target: row.target,
      outcome: row.outcome,
      detail: row.detail,
    };
    const expected = computeRowHash(expectedPrev, fields);
    if (expected !== row.row_hash) return { ok: false, firstBadId: Number(row.id), unchained };
    prev = row.row_hash;
  }
  return { ok: true, firstBadId: null, unchained };
}
