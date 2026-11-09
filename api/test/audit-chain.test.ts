import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshDb } from "./helpers.js";
import { audit } from "../src/db.js";
import { verifyChain, type AuditRow } from "../src/audit-chain.js";
import { exportAudit, verifyDb, verifyFile } from "../src/audit-cli.js";

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

  it("export then verify passes", async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), "audit-export-"));
    try {
      await audit(db, { actor: "u-alice", role: "admin", action: "source.create", target: "s1" });
      await audit(db, { actor: "u-bob", role: "engineer", action: "run.start", target: "r1" });
      await audit(db, { actor: "u-carol", role: "viewer", action: "source.list", outcome: "denied" });
      const out = join(dir, "audit.jsonl");
      const n = await exportAudit(db, out);
      expect(n).toBe(3);
      const fromFile = verifyFile(out);
      expect(fromFile).toEqual({ ok: true, firstBadId: null, unchained: 0 });
      const fromDb = await verifyDb(db);
      expect(fromDb).toEqual({ ok: true, firstBadId: null, unchained: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.end();
    }
  });

  it("tampered row is detected", async () => {
    const db = await freshDb();
    try {
      await audit(db, { actor: "u-alice", role: "admin", action: "source.create", target: "s1" });
      await audit(db, { actor: "u-bob", role: "engineer", action: "run.start", target: "r1" });
      await audit(db, { actor: "u-carol", role: "viewer", action: "source.list", outcome: "denied" });
      const list = await rows(db);
      const target = list[1]!;
      await db.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change");
      try {
        await db.query("UPDATE audit_log SET detail = $1 WHERE id = $2", [JSON.stringify({ tampered: true }), target.id]);
      } finally {
        await db.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change");
      }
      const result = await verifyDb(db);
      expect(result.ok).toBe(false);
      expect(result.firstBadId).toBe(Number(target.id));
    } finally {
      await db.end();
    }
  });

  it("deleted row is detected", async () => {
    const db = await freshDb();
    try {
      await audit(db, { actor: "u-alice", role: "admin", action: "source.create", target: "s1" });
      await audit(db, { actor: "u-bob", role: "engineer", action: "run.start", target: "r1" });
      await audit(db, { actor: "u-carol", role: "viewer", action: "source.list", outcome: "denied" });
      const list = await rows(db);
      const middle = list[1]!;
      const after = list[2]!;
      await db.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change");
      try {
        await db.query("DELETE FROM audit_log WHERE id = $1", [middle.id]);
      } finally {
        await db.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change");
      }
      const result = await verifyDb(db);
      expect(result.ok).toBe(false);
      expect(result.firstBadId).toBe(Number(after.id));
    } finally {
      await db.end();
    }
  });

  it("rows before the chain migration are reported as unchained, not as tampered", async () => {
    const db = await freshDb();
    try {
      await db.query(
        "INSERT INTO audit_log (at, actor, role, action, target, outcome, detail) VALUES (now(), 'u-old', 'admin', 'source.create', 's0', 'ok', '{}')",
      );
      await db.query(
        "INSERT INTO audit_log (at, actor, role, action, target, outcome, detail) VALUES (now(), 'u-old', 'admin', 'source.create', 's0b', 'ok', '{}')",
      );
      await audit(db, { actor: "u-alice", role: "admin", action: "source.create", target: "s1" });
      await audit(db, { actor: "u-bob", role: "engineer", action: "run.start", target: "r1" });
      const result = await verifyDb(db);
      expect(result.ok).toBe(true);
      expect(result.firstBadId).toBeNull();
      expect(result.unchained).toBe(2);
    } finally {
      await db.end();
    }
  });
});
