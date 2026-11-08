"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/components/Shell";
import { Badge } from "@/components/Ui";

type Entry = { id: number; at: string; actor: string; role: string | null; action: string; target: string | null; outcome: "ok" | "denied" | "error"; detail: unknown };

export default function Audit() {
  const me = useMe()!;
  const [rows, setRows] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { if (me.role === "admin") api<Entry[]>("/audit").then(setRows).catch((e) => setError(e.message)); }, [me.role]);

  if (me.role !== "admin") return <p role="alert" className="badge badge-bad">The audit log is for admins only.</p>;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="muted">Every sign-in, change and denied request. The database refuses edits and deletes on this table.</p>
      {error && <p role="alert" className="badge badge-bad">{error}</p>}
      <div className="card scroll-x">
        <table className="t" data-testid="audit-table">
          <thead><tr><th>Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.actor}</td><td>{r.role ?? "-"}</td><td><code>{r.action}</code></td><td>{r.target ?? "-"}</td>
                <td><Badge tone={r.outcome === "ok" ? "ok" : r.outcome === "denied" ? "warn" : "bad"}>{r.outcome}</Badge></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
