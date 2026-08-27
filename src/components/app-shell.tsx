"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/leases", label: "Leases" },
  { href: "/leasing", label: "Leasing CRM" },
  { href: "/payments", label: "Payments" },
  { href: "/maintenance", label: "Maintenance" },
  { href: "/providers", label: "Providers" },
  { href: "/listings", label: "Listings" },
  { href: "/inbox", label: "Inbox" },
  { href: "/ai", label: "AI" },
  { href: "/documents", label: "Documents" },
  { href: "/team", label: "Team" },
];

const SETTINGS_LINKS = [
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/communications", label: "Communications" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/reminders", label: "Reminders" },
];

const AI_LINKS = [
  { href: "/ai", label: "AI property manager" },
  { href: "/ai/employees", label: "AI employees" },
  { href: "/ai/autonomy", label: "Autonomy and activity" },
  { href: "/ai/voice", label: "Voice" },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

async function signOut(router: ReturnType<typeof useRouter>) {
  await fetch("/api/auth/logout", { method: "POST" });
  try {
    window.localStorage.removeItem("propertyos.activeOrganisationId");
  } catch {
    // Best-effort only; an unavailable localStorage must never block sign-out.
  }
  router.push("/login");
  router.refresh();
}

function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const inSettings = pathname.startsWith("/settings");

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link className="flex items-baseline gap-2" href="/dashboard">
          <span className="text-base font-semibold tracking-tight text-slate-950">NesAfric</span>
          <span className="hidden text-[11px] font-medium tracking-[0.12em] text-slate-400 sm:inline">PROPERTYOS</span>
        </Link>

        <div className="hidden items-center gap-2 lg:flex">
          <WorkspaceSwitcher current={{ kind: "propertyos", label: "Property Management" }} />
          <Link
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${inSettings ? "bg-slate-100 text-slate-950" : "text-slate-600 hover:text-slate-950"}`}
            href="/settings/billing"
          >
            Settings
          </Link>
          <button
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-300"
            onClick={() => void signOut(router)}
            type="button"
          >
            Sign out
          </button>
        </div>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 lg:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      <nav className="hidden border-t border-slate-100 bg-slate-50/60 lg:block">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-2 sm:px-6">
          {NAV_LINKS.map((link) => (
            <Link
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                isActive(pathname, link.href) ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-950"
              }`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden">
          <nav className="grid grid-cols-2 gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                className={`rounded-md px-3 py-2 text-sm font-medium ${isActive(pathname, link.href) ? "bg-slate-100 text-slate-950" : "text-slate-700"}`}
                href={link.href}
                key={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="px-3 text-xs font-semibold tracking-wide text-slate-400">SETTINGS</p>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {SETTINGS_LINKS.map((link) => (
                <Link
                  className={`rounded-md px-3 py-2 text-sm font-medium ${pathname === link.href ? "bg-slate-100 text-slate-950" : "text-slate-700"}`}
                  href={link.href}
                  key={link.href}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <Link className="mt-4 block rounded-md border border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-700" href="/pro" onClick={() => setOpen(false)}>
            Marketplace workspace
          </Link>
          <button
            className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
            onClick={() => void signOut(router)}
            type="button"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}

function SubTabs({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <div className="mb-8 flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {links.map((link) => (
        <Link
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            pathname === link.href ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          }`}
          href={link.href}
          key={link.href}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

type AppShellProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  size?: "wide" | "medium" | "narrow";
  subTabs?: "settings" | "ai";
  children: ReactNode;
};

const SUB_TAB_LINKS = { settings: SETTINGS_LINKS, ai: AI_LINKS };
const SIZE_CLASSES = { wide: "max-w-7xl", medium: "max-w-5xl", narrow: "max-w-2xl" };

/**
 * Consistent authenticated-app chrome: a persistent, always-present navigation bar (every major
 * section is reachable from every page, and sign-out is always available) plus a standardised
 * page header. Replaces each page's previously hand-rolled, inconsistent header/back-link.
 */
export function AppShell({ eyebrow, title, description, actions, size = "wide", subTabs, children }: AppShellProps) {
  return (
    <>
      <AppNav />
      <main className={`mx-auto w-full ${SIZE_CLASSES[size]} px-4 py-8 sm:px-6 sm:py-12`}>
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            {eyebrow && <p className="text-sm font-semibold text-emerald-700">{eyebrow}</p>}
            <h1 className="mt-1 text-3xl font-semibold text-slate-950">{title}</h1>
            {description && <p className="mt-2 max-w-2xl text-slate-600">{description}</p>}
          </div>
          {actions && <div className="flex flex-shrink-0 flex-wrap gap-2">{actions}</div>}
        </header>
        {subTabs && <SubTabs links={SUB_TAB_LINKS[subTabs]} />}
        {children}
      </main>
    </>
  );
}
