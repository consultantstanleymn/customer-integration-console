import type { ReactNode } from "react";

export const Badge = ({ tone, children }: { tone: "ok" | "bad" | "warn"; children: ReactNode }) => <span className={`badge badge-${tone}`}>{children}</span>;

export const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="card"><div className="muted text-sm">{label}</div><div className="mt-1 text-3xl font-semibold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div></div>
);

export const statusTone = (s: string) => (s === "success" ? "ok" : s === "failed" ? "bad" : "warn") as "ok" | "bad" | "warn";

export function Notice({ kind, children }: { kind: "ok" | "bad"; children: ReactNode }) {
  return <p role={kind === "bad" ? "alert" : "status"} className={`badge badge-${kind}`} style={{ borderRadius: 8, padding: ".5rem .75rem", display: "block" }}>{children}</p>;
}
