"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { buttonClass } from "@/components/ui/button-styles";

type WhoAmI = { isPlatformPrincipal: boolean; role?: string };

type NavItem = { href: string; label: string };

/** Same routes as before, grouped by the job an operator is doing. Grouping is presentation only —
 * every route keeps its own server-side platform-principal authorization. */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: "Console", items: [{ href: "/platform-admin", label: "Overview" }] },
  {
    label: "Customers",
    items: [
      { href: "/platform-admin/organisations", label: "Organisations" },
      { href: "/platform-admin/users", label: "Users" },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { href: "/platform-admin/professionals", label: "Real Estate Professionals" },
      { href: "/platform-admin/marketplace", label: "Marketplace" },
      { href: "/platform-admin/listings", label: "Listings" },
      { href: "/platform-admin/campaigns", label: "Campaigns" },
    ],
  },
  {
    label: "Trust and safety",
    items: [
      { href: "/platform-admin/verification", label: "Verification" },
      { href: "/platform-admin/service-providers", label: "Providers & verification" },
      { href: "/platform-admin/audit", label: "Audit Log" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/platform-admin/maintenance", label: "Maintenance" },
      { href: "/platform-admin/communications", label: "Communications" },
      { href: "/platform-admin/ai", label: "AI Operations" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/platform-admin/plans", label: "Plans & entitlements" },
      { href: "/platform-admin/subscriptions", label: "Subscriptions" },
      { href: "/platform-admin/payments", label: "Payments & reconciliation" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/platform-admin/flags", label: "Feature flags" },
      { href: "/platform-admin/system", label: "System Health" },
      { href: "/platform-admin/settings", label: "Platform Settings" },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

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

  if (status === "loading") return <main className="min-h-screen bg-warm-white px-6 py-12"><p className="text-sm text-muted" role="status">Checking platform access…</p></main>;
  if (status === "signed-out") return <AccessGate title="Sign in to continue" tone="info" message="Platform access is separate from normal organisation access. Sign in on this deployment, then reopen the console." action={<Link className={buttonClass("primary")} href="/login">Sign in</Link>} />;
  if (status === "error") return <AccessGate title="Access check unavailable" tone="danger" message="Could not verify platform access right now. Reload to try again." action={<Link className={buttonClass("secondary")} href="/dashboard">Back to workspace</Link>} />;
  if (status === "denied") return <AccessGate title="Platform access required" tone="danger" message="Organisation owners and administrators do not automatically receive platform access. Contact a NesAfric platform operator if you believe this is an error." action={<Link className={buttonClass("secondary")} href="/dashboard">Back to workspace</Link>} />;

  const current = NAV.find((item) => active(pathname, item.href));
  const nav = (
    <nav aria-label="Platform operations" className="grid gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-[11px] font-medium text-white/55">{group.label}</p>
          <ul className="mt-1.5 grid gap-0.5">
            {group.items.map((item) => {
              const isActive = active(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={`relative flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 text-[13px] font-medium transition-colors ${
                      isActive
                        ? "bg-white/[0.09] text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-gold"
                        : "text-white/75 hover:bg-white/[0.05] hover:text-white"
                    }`}
                    href={item.href}
                  >
                    {item.label}
                    {item.href === "/platform-admin/service-providers" && !!pendingProviders && (
                      <span className="text-xs font-semibold tabular-nums text-gold-soft">
                        {pendingProviders}
                        <span className="sr-only"> pending</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return <div className="min-h-screen bg-warm-white lg:flex">
    <aside className="shrink-0 bg-forest-deep text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <Link href="/platform-admin"><BrandLogo height={28} variant="dark" /></Link>
        <span className="text-[11px] font-semibold text-gold-soft">Platform admin</span>
      </div>
      {/* Small screens: the menu is collapsed behind the current page so content comes first. */}
      <details className="group border-b border-white/10 lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span><span className="text-white/60">Menu · </span>{current?.label ?? "Operations console"}</span>
          <svg aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="px-2 pb-5">{nav}</div>
      </details>
      <div className="hidden min-h-0 flex-1 overflow-y-auto px-2 py-5 lg:block">{nav}</div>
      <p className="hidden border-t border-white/10 px-5 py-4 text-xs leading-5 text-white/55 lg:block">Privileged controls are audited. Customer workspaces remain separate.</p>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="border-b border-hairline bg-white px-5 py-4 sm:px-8">
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">NesAfric platform</p>
            <h1 className="mt-0.5 text-xl font-semibold text-forest-deep">{current?.label ?? "Operations console"}</h1>
          </div>
          {role && <span className="text-xs font-semibold text-forest">{role.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>}
        </div>
      </header>
      <div className="w-full px-5 py-7 sm:px-8 sm:py-9">{children}</div>
    </main>
  </div>;
}

function AccessGate({ title, message, action, tone }: { title: string; message: string; action: ReactNode; tone: "info" | "danger" }) {
  return (
    <main className="min-h-screen bg-warm-white px-6 py-16">
      <div className="mx-auto max-w-lg">
        <p className="text-sm font-medium text-gold-ink">Platform operations</p>
        <h1 className="mt-2 text-2xl font-semibold text-forest-deep">{title}</h1>
        <p className={`mt-4 border-l-2 px-4 py-3 text-sm leading-6 ${tone === "danger" ? "border-danger bg-danger-tint text-danger-ink" : "border-gold bg-gold/10 text-ink"}`}>{message}</p>
        <div className="mt-6">{action}</div>
      </div>
    </main>
  );
}
