"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { canWrite } from "@/lib/format";
import { useMe } from "@/components/Shell";
import { Notice } from "@/components/Ui";

type DL = { id: number; run_id: number; source_name: string; payload: Record<string, unknown>; errors: string[]; status: string; created_at: string };

export default function DeadLetters() {
  const me = useMe()!;
  const writer = canWrite(me.role);
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState<DL[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(() => api<DL[]>(`/dead-letters?status=${status}`).then(setItems).catch((e) => setMsg({ kind: "bad", text: e.message })), [status]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    try { setMsg({ kind: "ok", text: await fn() }); } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    load();
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Dead letters</h1>
      <p className="muted">Rows that failed validation. Fix the JSON, then replay it. A replay loads the row through the same pipeline.</p>
      <div role="tablist" aria-label="Status" className="flex gap-2">
        {["pending", "replayed", "discarded"].map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={`btn ${status === s ? "" : "btn-ghost"}`} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {items.length === 0 && <p className="muted">Nothing here.</p>}
      {items.map((d) => (
        <article key={d.id} className="card grid gap-2" data-testid="dead-letter">
          <header className="flex flex-wrap justify-between gap-2"><strong>#{d.id} from {d.source_name}</strong><span className="muted text-sm">run #{d.run_id}</span></header>
          <ul className="text-sm" style={{ color: "var(--bad)" }}>{d.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          <label className="text-sm">Row (editable JSON)
            <textarea className="field font-mono text-xs" rows={6} disabled={!writer || d.status !== "pending"}
              value={edits[d.id] ?? JSON.stringify(d.payload, null, 2)} onChange={(e) => setEdits({ ...edits, [d.id]: e.target.value })} />
          </label>
          {writer && d.status === "pending" && (
            <div className="flex gap-2">
              <button className="btn" onClick={() => act(async () => {
                let payload: unknown;
                try { payload = edits[d.id] ? JSON.parse(edits[d.id]!) : undefined; } catch { throw new Error("The JSON is not valid."); }
                const r = await api<{ rowsLoaded: number }>(`/dead-letters/${d.id}/replay`, { json: { payload } });
                return `Replayed #${d.id}: ${r.rowsLoaded} row loaded.`;
              })}>Replay</button>
              <button className="btn btn-ghost" onClick={() => act(async () => { await api(`/dead-letters/${d.id}/discard`, { method: "POST" }); return `Discarded #${d.id}.`; })}>Discard</button>
            </div>)}
        </article>
      ))}
    </div>
  );
}
