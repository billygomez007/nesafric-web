"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode } from "react";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

/**
 * The Marketplace professional workspace's own chrome (Phase 21A item 6) — deliberately separate
 * from `AppShell` (the PropertyOS management shell). Never links to PropertyOS management screens
 * (dashboard, properties, tenants, leases, ...): a marketplace-only account must never be shown
 * PropertyOS functionality it hasn't separately subscribed to (item 6/11).
 */
export function MarketplaceProShell({ professionalId, children }: { professionalId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/pro/${professionalId}`;
  const links = [
    { href: base, label: "Dashboard" },
    { href: `${base}/listings`, label: "Listings" },
    { href: `${base}/leads`, label: "Leads" },
    { href: `${base}/developments`, label: "Developments" },
    { href: `${base}/team`, label: "Team" },
    { href: `${base}/promotions`, label: "Promotions" },
    { href: `${base}/voice`, label: "Voice" },
  ];

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    try {
      window.localStorage.removeItem("nesafric.activeMarketplaceProfessionalId");
      window.localStorage.removeItem("propertyos.activeOrganisationId");
    } catch {
      // Best-effort only.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-baseline gap-3">
            <Link className="text-base font-semibold tracking-tight text-slate-950" href="/pro">NesAfric Marketplace</Link>
            <span className="hidden text-[11px] font-medium tracking-[0.12em] text-slate-400 sm:inline">PROFESSIONAL</span>
          </div>
          <div className="flex items-center gap-2">
            <WorkspaceSwitcher current={{ kind: "marketplace", label: "Marketplace Professional" }} />
            <button className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-300" onClick={() => void signOut()} type="button">
              Sign out
            </button>
          </div>
        </div>
        <nav className="border-t border-slate-100 bg-slate-50/60">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 py-2 sm:px-6">
            {links.map((link) => (
              <Link
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${pathname === link.href ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-950"}`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </>
  );
}
