"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, setCsrf, type Me } from "@/lib/api";

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/sources", label: "Sources" },
  { href: "/dead-letters", label: "Dead letters" },
  { href: "/audit", label: "Audit log", admin: true },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<Me>("/me")
      .then((m) => { setCsrf(m.csrfToken); setMe(m); })
      .catch(() => { if (path !== "/login") window.location.href = "/login"; })
      .finally(() => setReady(true));
  }, [path]);

  if (path === "/login") return <main className="mx-auto max-w-md px-4 py-24">{children}</main>;
  if (!ready || !me) return <p className="p-8 muted" role="status">Loading...</p>;

  return (
    <MeCtx.Provider value={me}>
      <header className="border-b" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <strong className="text-lg">Integration Console</strong>
          <nav aria-label="Main" className="flex flex-wrap gap-4">
            {LINKS.filter((l) => !l.admin || me.role === "admin").map((l) => (
              <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}
                className={path === l.href ? "font-semibold underline underline-offset-4" : "muted hover:underline"}>{l.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span data-testid="whoami">{me.name} <span className="badge badge-ok">{me.role}</span></span>
            <button className="btn btn-ghost" onClick={async () => { await api("/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </MeCtx.Provider>
  );
}
