"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

type WhoAmI = { isPlatformPrincipal: boolean; role?: string };

const NAV = [
  { href: "/platform-admin", label: "Overview" },
  { href: "/platform-admin/organisations", label: "Organisations" },
  { href: "/platform-admin/users", label: "Users" },
  { href: "/platform-admin/professionals", label: "Real Estate Professionals" },
  { href: "/platform-admin/marketplace", label: "Marketplace" },
  { href: "/platform-admin/listings", label: "Listings" },
  { href: "/platform-admin/verification", label: "Verification" },
  { href: "/platform-admin/service-providers", label: "Providers & verification" },
  { href: "/platform-admin/campaigns", label: "Campaigns" },
  { href: "/platform-admin/plans", label: "Plans & entitlements" },
  { href: "/platform-admin/subscriptions", label: "Subscriptions" },
  { href: "/platform-admin/payments", label: "Payments & reconciliation" },
  { href: "/platform-admin/flags", label: "Feature flags" },
  { href: "/platform-admin/health", label: "Operations" },
  { href: "/platform-admin/audit", label: "Audit activity" },
];

function active(pathname: string, href: string) {
  return href === "/platform-admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Privileged shell for platform operations. The whoami check controls presentation only; every
 * child API retains its own server-side platform-principal authorization and permission checks.
 */
export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<"loading" | "signed-out" | "denied" | "error" | "allowed">("loading");
  const [role, setRole] = useState<string | undefined>();
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
            .then((result) => (result.ok ? result.json() : null))
            .then((count) => { if (count) setPendingProviders(count.count); })
            .catch(() => undefined);
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") return <main className="min-h-screen bg-warm-white px-6 py-12"><p className="text-sm text-muted">Checking platform access…</p></main>;
  if (status === "signed-out") return <main className="min-h-screen bg-warm-white px-6 py-16"><div className="mx-auto max-w-lg rounded-2xl border border-hairline bg-white p-8 shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">PLATFORM OPERATIONS</p><h1 className="mt-3 text-2xl font-semibold text-forest">Sign in to continue</h1><p className="mt-3 rounded-xl border border-gold/20 bg-gold/10 p-4 text-sm leading-6 text-ink">Platform access is separate from normal organisation access. Sign in on this deployment, then reopen the console.</p><Link className="mt-6 inline-flex rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald" href="/login">Sign in</Link></div></main>;
  if (status === "error") return <main className="min-h-screen bg-warm-white px-6 py-16"><div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">PLATFORM OPERATIONS</p><h1 className="mt-3 text-2xl font-semibold text-forest">Access check unavailable</h1><p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">Could not verify platform access right now. Reload to try again.</p><Link className="mt-6 inline-flex rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-forest" href="/dashboard">Back to workspace</Link></div></main>;
  if (status === "denied") return <main className="min-h-screen bg-warm-white px-6 py-16"><div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 shadow-card"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">PLATFORM OPERATIONS</p><h1 className="mt-3 text-2xl font-semibold text-forest">Platform access required</h1><p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">Organisation owners and administrators do not automatically receive platform access. Contact a NesAfric platform operator if you believe this is an error.</p><Link className="mt-6 inline-flex rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-forest" href="/dashboard">Back to workspace</Link></div></main>;

  return <div className="min-h-screen bg-warm-white lg:flex">
    <aside className="w-full shrink-0 bg-forest-deep text-white lg:sticky lg:top-0 lg:h-screen lg:w-64">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5"><Link href="/platform-admin"><BrandLogo height={29} variant="light" /></Link><span className="rounded-full border border-gold/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold-soft">Admin</span></div>
      <div className="px-4 py-5"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Operations console</p><nav className="mt-3 grid gap-1">{NAV.map((item) => <Link className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${active(pathname, item.href) ? "bg-teal text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`} href={item.href} key={item.href}>{item.label}{item.href === "/platform-admin/service-providers" && !!pendingProviders && <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold text-forest-deep">{pendingProviders}</span>}</Link>)}</nav></div>
      <div className="border-t border-white/10 px-7 py-5 text-xs leading-5 text-white/45">Privileged controls are audited. Customer workspaces remain separate.</div>
    </aside>
    <main className="min-w-0 flex-1"><header className="border-b border-hairline bg-white px-5 py-5 sm:px-8"><div className="flex w-full flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">NesAfric platform</p><h1 className="mt-1 text-xl font-semibold text-forest">Operations console</h1></div><span className="rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-white">{role?.replaceAll("_", " ")}</span></div></header><div className="w-full px-5 py-7 sm:px-8 sm:py-9">{children}</div></main>
  </div>;
}
