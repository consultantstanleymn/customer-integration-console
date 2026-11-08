"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ago, canWrite, health } from "@/lib/format";
import { useMe } from "@/components/Shell";
import { Badge, Notice } from "@/components/Ui";

type Source = { id: number; name: string; type: "csv" | "rest" | "webhook"; config: Record<string, string>; watermark: string | null; last_status: string | null; last_success_at: string | null; pending_dead_letters: number; pending_events: number };
type RunResult = { runId: number; status: string; rowsIn: number; rowsLoaded: number; rowsFailed: number };

export default function Sources() {
  const me = useMe()!;
  const writer = canWrite(me.role);
  const [sources, setSources] = useState<Source[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", type: "csv", baseUrl: "", apiKey: "" });

  const load = useCallback(() => api<Source[]>("/sources").then(setSources).catch((e) => setMsg({ kind: "bad", text: e.message })), []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    try { setMsg({ kind: "ok", text: await fn() }); } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    load();
  };
  const summary = (r: RunResult) => `Run #${r.runId} ${r.status}: ${r.rowsIn} in, ${r.rowsLoaded} loaded, ${r.rowsFailed} failed.`;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Sources</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {writer ? (
        <form className="card grid gap-3 md:grid-cols-5 md:items-end" aria-label="Create source" onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const config = form.type === "rest" ? { baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}) } : {};
            const r = await api<{ id: number; webhookSecret?: string }>("/sources", { json: { name: form.name, type: form.type, config } });
            setForm({ name: "", type: "csv", baseUrl: "", apiKey: "" });
            return r.webhookSecret ? `Source created. Webhook URL /api/webhooks/${r.id}. Secret (shown once): ${r.webhookSecret}` : `Source #${r.id} created.`;
          });
        }}>
          <label className="text-sm">Name<input className="field" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-sm">Type
            <select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="csv">CSV upload</option><option value="rest">REST API</option><option value="webhook">Webhook</option>
            </select></label>
          {form.type === "rest" ? (<>
            <label className="text-sm">Base URL<input className="field" required placeholder="http://localhost:4200" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></label>
            <label className="text-sm">API key<input className="field" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></label>
          </>) : <><span /><span /></>}
          <button className="btn" type="submit">Create source</button>
        </form>
      ) : <p className="muted">Your role ({me.role}) can view sources but not change them.</p>}

      <div className="card scroll-x">
        <table className="t" data-testid="sources-table">
          <thead><tr><th>Name</th><th>Type</th><th>Health</th><th>Watermark</th><th>Last success</th><th>Actions</th></tr></thead>
          <tbody>
            {sources.map((s) => { const h = health(s); return (
              <tr key={s.id} data-testid={`source-${s.name}`}>
                <td>{s.name}</td><td>{s.type}</td><td><Badge tone={h.tone}>{h.label}</Badge></td>
                <td><code className="text-xs">{s.watermark ?? "none"}</code></td><td>{ago(s.last_success_at)}</td>
                <td className="flex flex-wrap gap-2">
                  {s.type === "csv" && (
                    <label className={`btn btn-ghost ${writer ? "cursor-pointer" : "opacity-50"}`}>Upload CSV
                      <input type="file" accept=".csv,text/csv" className="sr-only" disabled={!writer} aria-label={`Upload CSV to ${s.name}`}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) act(async () => summary(await api<RunResult>(`/sources/${s.id}/upload`, { text: await f.text() }))); e.target.value = ""; }} />
                    </label>)}
                  {s.type !== "csv" && <button className="btn btn-ghost" disabled={!writer} onClick={() => act(async () => summary(await api<RunResult>(`/sources/${s.id}/run`, { method: "POST" })))}>Run now</button>}
                  {me.role === "admin" && <button className="btn btn-danger" onClick={() => { if (confirm(`Delete ${s.name} and all its data?`)) act(async () => { await api(`/sources/${s.id}`, { method: "DELETE" }); return `Deleted ${s.name}.`; }); }}>Delete</button>}
                </td>
              </tr>); })}
            {sources.length === 0 && <tr><td colSpan={6} className="muted">No sources yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
