"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

type WhoAmI = { isPlatformPrincipal: boolean; role?: string };

const NAV = [
  { href: "/platform-admin", label: "Overview" },
  { href: "/platform-admin/organisations", label: "Organisations" },
  { href: "/platform-admin/plans", label: "Plans" },
  { href: "/platform-admin/campaigns", label: "Campaigns" },
  { href: "/platform-admin/service-providers", label: "Service providers" },
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
  const [status, setStatus] = useState<"loading" | "signed-out" | "denied" | "error" | "allowed">("loading");
  const [role, setRole] = useState<string | undefined>(undefined);
  const [pendingProviders, setPendingProviders] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/platform-admin/whoami")
      .then(async (response) => {
        if (response.status === 401) return setStatus("signed-out");
        if (!response.ok) return setStatus("error");
        const body = (await response.json()) as WhoAmI;
        setStatus(body.isPlatformPrincipal ? "allowed" : "denied");
        setRole(body.role);
        if (body.isPlatformPrincipal) {
          fetch("/api/platform-admin/service-providers/pending-count")
            .then((r) => (r.ok ? r.json() : null))
            .then((body2) => { if (body2) setPendingProviders(body2.count); })
            .catch(() => undefined);
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") return <main className="mx-auto max-w-6xl px-6 py-12"><p className="text-slate-600">Checking platform access…</p></main>;
  if (status === "signed-out") return <main className="mx-auto max-w-2xl px-6 py-16">
    <h1 className="text-2xl font-semibold">Platform administration</h1>
    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">You are not signed in on this deployment. Each preview deployment has its own address, so a sign-in on a different preview URL does not carry over. Sign in again, then reopen this page.</p>
    <Link className="mt-6 inline-block font-semibold text-emerald-700" href="/login">Sign in →</Link>
  </main>;
  if (status === "error") return <main className="mx-auto max-w-2xl px-6 py-16">
    <h1 className="text-2xl font-semibold">Platform administration</h1>
    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">Could not verify platform access right now. This is a connectivity or server error, not necessarily a permissions denial — reload the page to try again.</p>
    <Link className="mt-6 inline-block font-semibold text-emerald-700" href="/dashboard">← Back to your organisation</Link>
  </main>;
  if (status === "denied") return <main className="mx-auto max-w-2xl px-6 py-16">
    <h1 className="text-2xl font-semibold">Platform administration</h1>
    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">You do not have platform access. This is completely separate from your organisation memberships — organisation owners and administrators are never automatically granted platform access. Contact a UmoAfric platform operator if you believe this is an error.</p>
    <Link className="mt-6 inline-block font-semibold text-emerald-700" href="/dashboard">← Back to your organisation</Link>
  </main>;

  return <main className="mx-auto max-w-6xl px-6 py-12">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-semibold text-emerald-700">UMOAFRIC PLATFORM ADMINISTRATION</p><h1 className="text-3xl font-semibold">Platform console</h1></div>
      {role && <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{role.replaceAll("_", " ")}</span>}
    </header>
    <nav className="mt-6 flex flex-wrap gap-2">
      {NAV.map((item) => (
        <Link className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-semibold" href={item.href} key={item.href}>
          {item.label}
          {item.href === "/platform-admin/service-providers" && !!pendingProviders && (
            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{pendingProviders}</span>
          )}
        </Link>
      ))}
    </nav>
    <div className="mt-8">{children}</div>
  </main>;
}
