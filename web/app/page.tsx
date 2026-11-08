"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { ago, health, pct } from "@/lib/format";
import { Badge, Stat, statusTone } from "@/components/Ui";

type Stats = {
  throughput: { day: string; loaded: number; failed: number }[];
  quality: { source_id: number; source_name: string; run_id: number; score: number; checks: { check_name: string; passed: boolean; detail: string }[] }[];
  totals: { orders: number; runs: number; failed_runs: number; pending_dead_letters: number };
};
type Source = { id: number; name: string; type: string; watermark: string | null; last_status: string | null; last_success_at: string | null; pending_dead_letters: number; pending_events: number };
type Run = { id: number; source_name: string; kind: string; status: string; rows_in: number; rows_loaded: number; rows_failed: number; started_at: string; finished_at: string | null; triggered_by: string };

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<Stats>("/stats"), api<Source[]>("/sources"), api<Run[]>("/runs?limit=10")])
      .then(([s, so, r]) => { setStats(s); setSources(so); setRuns(r); })
      .catch((e) => setError(String(e.message)));
  }, []);

  if (error) return <p role="alert" className="badge badge-bad">{error}</p>;
  if (!stats) return <p className="muted" role="status">Loading dashboard...</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section aria-label="Totals" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Orders loaded" value={stats.totals.orders} />
        <Stat label="Runs" value={stats.totals.runs} />
        <Stat label="Failed runs" value={stats.totals.failed_runs} />
        <Stat label="Dead letters" value={stats.totals.pending_dead_letters} />
      </section>

      <section className="card" aria-labelledby="h-throughput">
        <h2 id="h-throughput" className="font-semibold">Throughput and errors (last 14 days)</h2>
        {stats.throughput.length === 0 ? <p className="muted mt-2">No runs yet. Create a source and run it.</p> : (
          <div className="mt-3" style={{ height: 240 }} role="img" aria-label="Bar chart of rows loaded and rows failed per day">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.throughput}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="day" stroke="var(--muted)" fontSize={12} />
                <YAxis stroke="var(--muted)" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--text)" }} />
                <Legend />
                <Bar dataKey="loaded" name="Rows loaded" fill="var(--chart-ok)" isAnimationActive={false} />
                <Bar dataKey="failed" name="Rows failed" fill="var(--chart-bad)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card" aria-labelledby="h-quality">
          <h2 id="h-quality" className="font-semibold">Data quality scorecard</h2>
          <p className="muted text-sm">Latest successful run of each source.</p>
          {stats.quality.length === 0 && <p className="muted mt-2">No quality results yet.</p>}
          {stats.quality.map((q) => (
            <div key={q.source_id} className="mt-3" data-testid="quality-card">
              <div className="flex items-center justify-between"><strong>{q.source_name}</strong><Badge tone={q.score === 1 ? "ok" : q.score >= 0.75 ? "warn" : "bad"}>{pct(q.score)}</Badge></div>
              <ul className="mt-1 text-sm">
                {q.checks.map((c) => (
                  <li key={c.check_name}><span aria-hidden="true">{c.passed ? "✓" : "✗"}</span> <span className="sr-only">{c.passed ? "passed" : "failed"}</span> <code>{c.check_name}</code> <span className="muted">{c.detail}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="card" aria-labelledby="h-health">
          <h2 id="h-health" className="font-semibold">Connector health</h2>
          <div className="scroll-x mt-2">
            <table className="t">
              <thead><tr><th>Source</th><th>Type</th><th>Status</th><th>Last success</th><th>Backlog</th></tr></thead>
              <tbody>
                {sources.map((s) => { const h = health(s); return (
                  <tr key={s.id}>
                    <td>{s.name}</td><td>{s.type}</td><td><Badge tone={h.tone}>{h.label}</Badge></td>
                    <td>{ago(s.last_success_at)}</td>
                    <td>{s.pending_dead_letters} dead, {s.pending_events} events</td>
                  </tr>); })}
                {sources.length === 0 && <tr><td colSpan={5} className="muted">No sources yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="h-runs">
        <h2 id="h-runs" className="font-semibold">Recent pipeline runs</h2>
        <div className="scroll-x mt-2">
          <table className="t" data-testid="runs-table">
            <thead><tr><th>Run</th><th>Source</th><th>Kind</th><th>Status</th><th>In</th><th>Loaded</th><th>Failed</th><th>Started</th><th>By</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}><td>#{r.id}</td><td>{r.source_name}</td><td>{r.kind}</td><td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  <td>{r.rows_in}</td><td>{r.rows_loaded}</td><td>{r.rows_failed}</td><td>{ago(r.started_at)}</td><td>{r.triggered_by}</td></tr>
              ))}
              {runs.length === 0 && <tr><td colSpan={9} className="muted">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
