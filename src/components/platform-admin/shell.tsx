"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

type WhoAmI = { isPlatformPrincipal: boolean; role?: string };

const NAV = [
  { href: "/platform-admin", label: "Overview" },
  { href: "/platform-admin/organisations", label: "Organisations" },
  { href: "/platform-admin/plans", label: "Plans" },
  { href: "/platform-admin/campaigns", label: "Campaigns" },
  { href: "/platform-admin/flags", label: "Feature flags" },
  { href: "/platform-admin/health", label: "Health & jobs" },
  { href: "/platform-admin/audit", label: "Audit" },
];

/**
 * Shell + access guard for every `/platform-admin` page (item 8). Authorization is enforced
 * server-side by every API route this UI calls (`requirePlatformPrincipal`); this client-side
 * check only decides what to render — an unauthorized user never receives platform data because
 * the underlying API calls made by child pages will 403 regardless of what this shows.
 */
export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "denied" | "allowed">("loading");
  const [role, setRole] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch("/api/platform-admin/whoami")
      .then(async (response) => (response.ok ? (await response.json()) as WhoAmI : { isPlatformPrincipal: false }))
      .then((body) => { setStatus(body.isPlatformPrincipal ? "allowed" : "denied"); setRole(body.role); })
      .catch(() => setStatus("denied"));
  }, []);

  if (status === "loading") return <main className="mx-auto max-w-6xl px-6 py-12"><p className="text-slate-600">Checking platform access…</p></main>;
  if (status === "denied") return <main className="mx-auto max-w-2xl px-6 py-16">
    <h1 className="text-2xl font-semibold">Platform administration</h1>
    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">You do not have platform access. This is completely separate from your organisation memberships — organisation owners and administrators are never automatically granted platform access. Contact a Umo Afric platform operator if you believe this is an error.</p>
    <Link className="mt-6 inline-block font-semibold text-emerald-700" href="/dashboard">← Back to your organisation</Link>
  </main>;

  return <main className="mx-auto max-w-6xl px-6 py-12">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-semibold text-emerald-700">UMO AFRIC PLATFORM ADMINISTRATION</p><h1 className="text-3xl font-semibold">Platform console</h1></div>
      {role && <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{role.replaceAll("_", " ")}</span>}
    </header>
    <nav className="mt-6 flex flex-wrap gap-2">
      {NAV.map((item) => <Link className="rounded border px-3 py-1.5 text-sm font-semibold" href={item.href} key={item.href}>{item.label}</Link>)}
    </nav>
    <div className="mt-8">{children}</div>
  </main>;
}
