import { describe, expect, it } from "vitest";
import { freshDb } from "./helpers.js";
import { audit } from "../src/db.js";
import { verifyChain, type AuditRow } from "../src/audit-chain.js";

async function rows(db: Awaited<ReturnType<typeof freshDb>>): Promise<AuditRow[]> {
  const r = await db.query("SELECT id, at, actor, role, action, target, outcome, detail, prev_hash, row_hash FROM audit_log ORDER BY id");
  return r.rows as AuditRow[];
}

describe("audit hash chain", () => {
  it("each new row links to the previous hash", async () => {
    const db = await freshDb();
    try {
      await audit(db, { actor: "u-alice", role: "admin", action: "source.create", target: "s1" });
      await audit(db, { actor: "u-bob", role: "engineer", action: "run.start", target: "r1" });
      await audit(db, { actor: "u-carol", role: "viewer", action: "source.list", outcome: "denied" });
      const list = await rows(db);
      expect(list).toHaveLength(3);
      expect(list[0]!.prev_hash).toBe("");
      expect(list[0]!.row_hash).toBeTruthy();
      expect(list[1]!.prev_hash).toBe(list[0]!.row_hash);
      expect(list[2]!.prev_hash).toBe(list[1]!.row_hash);
      expect(verifyChain(list).ok).toBe(true);
    } finally {
      await db.end();
    }
  });

  it("concurrent audit writes keep one chain", async () => {
    const db = await freshDb();
    try {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          audit(db, { actor: `u-${i}`, action: "run.start", target: `r-${i}` }),
        ),
      );
      const list = await rows(db);
      expect(list).toHaveLength(20);
      const result = verifyChain(list);
      expect(result.ok).toBe(true);
      expect(result.firstBadId).toBeNull();
    } finally {
      await db.end();
    }
  });

  it("verifyChain passes on untouched rows", async () => {
    const db = await freshDb();
    try {
      await audit(db, { actor: "u-alice", role: "admin", action: "source.create", detail: { name: "orders", type: "csv" } });
      await audit(db, { actor: "u-bob", role: "engineer", action: "run.start", detail: { runId: 7 } });
      const list = await rows(db);
      const result = verifyChain(list);
      expect(result).toEqual({ ok: true, firstBadId: null, unchained: 0 });
    } finally {
      await db.end();
    }
  });
});
