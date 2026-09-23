"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { BrandLogo } from "@/components/brand-logo";

type NavItem = {
  href: string;
  label: string;
  icon:
    | "dashboard"
    | "properties"
    | "tenants"
    | "leases"
    | "leasing"
    | "payments"
    | "maintenance"
    | "providers"
    | "listings"
    | "inbox"
    | "ai"
    | "documents"
    | "team";
};

const NAV_LINKS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/properties", label: "Properties", icon: "properties" },
  { href: "/tenants", label: "Tenants", icon: "tenants" },
  { href: "/leases", label: "Leases", icon: "leases" },
  { href: "/leasing", label: "Leasing CRM", icon: "leasing" },
  { href: "/payments", label: "Payments", icon: "payments" },
  { href: "/recurring-charges", label: "Recurring charges", icon: "payments" },
  { href: "/maintenance", label: "Maintenance", icon: "maintenance" },
  { href: "/providers", label: "Providers", icon: "providers" },
  { href: "/listings", label: "Listings", icon: "listings" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/ai", label: "AI", icon: "ai" },
  { href: "/documents", label: "Documents", icon: "documents" },
  { href: "/team", label: "Team", icon: "team" },
];

const SETTINGS_LINKS = [
  { href: "/settings", label: "Profile & account" },
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
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ name }: { name: NavItem["icon"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  const paths: Record<NavItem["icon"], ReactNode> = {
    dashboard: (
      <>
        <rect height="7" rx="1.5" width="7" x="3" y="3" />
        <rect height="7" rx="1.5" width="7" x="14" y="3" />
        <rect height="7" rx="1.5" width="7" x="3" y="14" />
        <rect height="7" rx="1.5" width="7" x="14" y="14" />
      </>
    ),
    properties: (
      <>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
    tenants: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6" />
        <circle cx="17" cy="9" r="2.25" />
        <path d="M15.5 14.5c3.2-.4 5 1.4 5.5 4.5" />
      </>
    ),
    leases: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h4" />
        <path d="M9 13h6M9 17h5" />
      </>
    ),
    leasing: (
      <>
        <path d="M4 19V9l8-5 8 5v10" />
        <path d="M8 19v-5h8v5" />
        <path d="M3 19h18" />
      </>
    ),
    payments: (
      <>
        <rect height="14" rx="2" width="18" x="3" y="5" />
        <path d="M3 9h18" />
        <path d="M7 15h4" />
      </>
    ),
    maintenance: (
      <>
        <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3z" />
      </>
    ),
    providers: (
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
        <path d="M17.5 6.5 19 8l2.5-3" />
      </>
    ),
    listings: (
      <>
        <rect height="16" rx="2" width="18" x="3" y="4" />
        <path d="m7 15 3-3 3 3 2-2 3 3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    ai: (
      <>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <rect height="10" rx="3" width="10" x="7" y="7" />
        <circle cx="10" cy="11" r=".6" fill="currentColor" stroke="none" />
        <circle cx="14" cy="11" r=".6" fill="currentColor" stroke="none" />
        <path d="M10 14h4" />
      </>
    ),
    documents: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h4M9 12h6M9 16h6" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6" />
        <path d="M15 15c3.2-.2 5 1.3 5.5 4" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0" {...common}>
      {paths[name]}
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function AppSidebar({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const inSettings = pathname.startsWith("/settings");

  return (
    <aside
      className={`flex h-full flex-col bg-forest-deep text-white ${
        mobile
          ? "w-[286px]"
          : "fixed inset-y-0 left-0 z-40 hidden w-[258px] lg:flex"
      }`}
    >
      <div className="flex h-[78px] items-center border-b border-white/10 px-6">
        <Link
          className="flex items-center"
          href="/dashboard"
          onClick={onNavigate}
        >
          <BrandLogo className="max-w-[150px]" height={34} variant="dark" />
        </Link>
      </div>

      <div className="border-b border-white/10 px-4 py-4">
        <WorkspaceSwitcher
          current={{ kind: "propertyos", label: "Property Management" }}
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Workspace
        </p>

        <div className="space-y-0.5">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);

            return (
              <Link
                className={`relative flex min-h-10 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-white/[0.08] text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-gold"
                    : "text-white/68 hover:bg-white/[0.05] hover:text-white"
                }`}
                href={link.href}
                key={link.href}
                onClick={onNavigate}
              >
                <span className={active ? "text-teal-light" : "text-white/55"}>
                  <NavIcon name={link.icon} />
                </span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Account
          </p>

          <Link
            className={`relative flex min-h-10 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
              inSettings
                ? "bg-white/[0.08] text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-gold"
                : "text-white/68 hover:bg-white/[0.05] hover:text-white"
            }`}
            href="/settings"
            onClick={onNavigate}
          >
            <span className={inSettings ? "text-teal-light" : "text-white/55"}>
              <SettingsIcon />
            </span>
            Settings
          </Link>
        </div>
      </nav>

      <div className="shrink-0 border-t border-white/10 bg-forest-deep p-4">
        <Link
          className="mb-2 flex items-center justify-center rounded-lg border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs font-semibold text-gold-light transition-colors hover:bg-gold/15"
          href="/pro"
          onClick={onNavigate}
        >
          Marketplace workspace
        </Link>

      </div>
    </aside>
  );
}

function MobileTopbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-hairline bg-warm-white/95 px-4 backdrop-blur lg:hidden">
      <button
        aria-label="Open navigation"
        className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-hairline bg-white text-forest"
        onClick={onMenu}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <BrandLogo height={27} variant="light" />

      <Link
        aria-label="Settings"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-white text-forest"
        href="/settings"
      >
        <SettingsIcon />
      </Link>
    </header>
  );
}

function DesktopTopbar() {
  return (
    <div className="hidden h-[78px] items-center justify-between border-b border-hairline bg-warm-white/95 px-8 lg:flex xl:px-10">
      <div className="relative w-full max-w-md">
        <svg
          aria-hidden="true"
          className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </svg>

        <input
          aria-label="Search workspace"
          className="h-10 w-full rounded-[9px] border border-hairline bg-white pl-10 pr-4 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10"
          placeholder="Search your workspace..."
          type="search"
        />
      </div>

      <div className="ml-6 flex items-center gap-3">
        <button
          aria-label="Notifications"
          className="relative flex h-10 w-10 items-center justify-center rounded-[9px] border border-hairline bg-white text-muted transition hover:border-teal/30 hover:text-forest"
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
        </button>

        <div className="flex items-center gap-3 border-l border-hairline pl-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-forest text-xs font-bold text-white">
            N
          </div>
          <div className="hidden xl:block">
            <p className="text-xs font-semibold text-ink">NesAfric Workspace</p>
            <p className="mt-0.5 text-[11px] text-muted">Property Management</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubTabs({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();

  return (
    <div className="mb-8 flex flex-wrap gap-6 border-b border-hairline">
      {links.map((link) => (
        <Link
          className={`border-b-2 px-1 pb-2 pt-1 text-sm font-medium transition-colors ${
            pathname === link.href
              ? "border-forest text-forest"
              : "border-transparent text-muted hover:border-hairline hover:text-forest"
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

const SUB_TAB_LINKS = {
  settings: SETTINGS_LINKS,
  ai: AI_LINKS,
};

const SIZE_CLASSES = {
  wide: "max-w-[1500px]",
  medium: "max-w-6xl",
  narrow: "max-w-3xl",
};

export function AppShell({
  eyebrow,
  title,
  description,
  actions,
  size = "wide",
  subTabs,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-warm-white text-ink">
      <AppSidebar />

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-forest-deep/55 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <div className="relative h-full w-fit shadow-2xl">
            <AppSidebar mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-h-screen lg:pl-[258px]">
        <MobileTopbar onMenu={() => setMobileOpen(true)} />
        <DesktopTopbar />

        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-9 xl:px-12">
          <div className={`mx-auto w-full ${SIZE_CLASSES[size]}`}>
            <header className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                {eyebrow && (
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
                    {eyebrow}
                  </p>
                )}

                <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
                  {title}
                </h1>

                {description && (
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                    {description}
                  </p>
                )}
              </div>

              {actions && (
                <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
              )}
            </header>

            {subTabs && <SubTabs links={SUB_TAB_LINKS[subTabs]} />}

            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
