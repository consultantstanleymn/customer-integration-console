import { EXPECTED_COLUMNS, REQUIRED_FIELDS } from "./schemas.js";

export type RawRow = Record<string, unknown>;
export type QualityResult = { name: string; passed: boolean; detail: string };

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Pure function: looks at the raw batch and says what is wrong. Results are stored per run. */
export function qualityChecks(rows: RawRow[], failedValidation: number): QualityResult[] {
  const seen = new Set<string>();
  for (const r of rows) Object.keys(r).forEach((k) => seen.add(k));
  const missing = EXPECTED_COLUMNS.filter((c) => !seen.has(c) && rows.length > 0);
  const extra = [...seen].filter((k) => !(EXPECTED_COLUMNS as readonly string[]).includes(k));

  const nullCounts = REQUIRED_FIELDS.map((f) => [f, rows.filter((r) => isEmpty(r[f])).length] as const).filter(([, n]) => n > 0);

  const ids = new Map<string, number>();
  for (const r of rows) if (!isEmpty(r.external_id)) ids.set(String(r.external_id), (ids.get(String(r.external_id)) ?? 0) + 1);
  const dupIds = [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  const rate = rows.length === 0 ? 1 : 1 - failedValidation / rows.length;

  return [
    {
      name: "schema_drift",
      passed: missing.length === 0 && extra.length === 0,
      detail: missing.length || extra.length ? `missing: [${missing.join(", ")}]; unexpected: [${extra.join(", ")}]` : "columns match the contract",
    },
    {
      name: "null_check",
      passed: nullCounts.length === 0,
      detail: nullCounts.length ? nullCounts.map(([f, n]) => `${f}: ${n} empty`).join("; ") : "no empty required fields",
    },
    {
      name: "duplicate_keys",
      passed: dupIds.length === 0,
      detail: dupIds.length ? `${dupIds.length} repeated external_id, e.g. ${dupIds.slice(0, 3).join(", ")}` : "no repeated external_id",
    },
    {
      name: "validation_rate",
      passed: rate >= 0.9,
      detail: `${(rate * 100).toFixed(1)}% of rows valid (threshold 90%)`,
    },
  ];
}

export const qualityScore = (rs: { passed: boolean }[]) => (rs.length ? rs.filter((r) => r.passed).length / rs.length : 1);
