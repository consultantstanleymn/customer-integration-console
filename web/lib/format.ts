export const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Health of a connector, from its last run and backlog. Shown as text, not only colour. */
export function health(s: { last_status: string | null; pending_dead_letters: number }): { label: string; tone: "ok" | "bad" | "warn" } {
  if (s.last_status === null) return { label: "never run", tone: "warn" };
  if (s.last_status === "failed") return { label: "failing", tone: "bad" };
  if (s.pending_dead_letters > 0) return { label: "needs attention", tone: "warn" };
  return { label: "healthy", tone: "ok" };
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const canWrite = (role: string) => role === "engineer" || role === "admin";
