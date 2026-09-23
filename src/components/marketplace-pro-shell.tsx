"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

type ProIcon =
  | "dashboard"
  | "listing"
  | "leads"
  | "developments"
  | "team"
  | "promotions"
  | "voice";

function Icon({ name }: { name: ProIcon }) {
  const paths: Record<ProIcon, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    listing: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h7M7 17h5" />
      </>
    ),
    leads: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6" />
        <path d="M17 6h4M19 4v4" />
      </>
    ),
    developments: (
      <>
        <path d="M4 21V9l6-3v15M10 21V4l10 4v13" />
        <path d="M7 12h1M7 16h1M14 10h2M14 14h2M14 18h2" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6M15 15c3-.2 5 1.3 5.5 4" />
      </>
    ),
    promotions: (
      <>
        <path d="m4 13 12-6v10L4 13Z" />
        <path d="M8 14v5M18 9v6" />
      </>
    ),
    voice: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

type ProLink = {
  href: string;
  label: string;
  icon: ProIcon;
};

function isProfessionalRouteActive(
  pathname: string,
  base: string,
  href: string,
) {
  return href === base
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function ProfessionalSidebar({
  base,
  links,
  pathname,
  mobile = false,
  onNavigate,
  onSignOut,
}: {
  base: string;
  links: ProLink[];
  pathname: string;
  mobile?: boolean;
  onNavigate: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside
      className={`flex h-full flex-col bg-[#102d2a] text-white ${
        mobile
          ? "w-[286px]"
          : "fixed inset-y-0 left-0 z-40 hidden w-[258px] lg:flex"
      }`}
    >
      <div className="flex h-[78px] items-center border-b border-white/10 px-6">
        <Link href="/pro" onClick={onNavigate}>
          <BrandLogo className="max-w-[150px]" height={34} variant="dark" />
        </Link>
      </div>

      <div className="border-b border-white/10 px-4 py-4">
        <WorkspaceSwitcher
          current={{
            kind: "marketplace",
            label: "Professional Management",
          }}
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
          Professional workspace
        </p>

        <div className="space-y-0.5">
          {links.map((link) => {
            const active = isProfessionalRouteActive(
              pathname,
              base,
              link.href,
            );

            return (
              <Link
                className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition ${
                  active
                    ? "bg-teal/20 text-white ring-1 ring-inset ring-teal/25"
                    : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                }`}
                href={link.href}
                key={link.href}
                onClick={onNavigate}
              >
                <span
                  className={
                    active ? "text-teal-light" : "text-white/50"
                  }
                >
                  <Icon name={link.icon} />
                </span>
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <Link
          className="mb-2 flex items-center justify-center rounded-lg border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs font-semibold text-gold-light"
          href="/dashboard"
          onClick={onNavigate}
        >
          Property management
        </Link>

        <button
          className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-white/55 hover:bg-white/[0.06] hover:text-white"
          onClick={onSignOut}
          type="button"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

export function MarketplaceProShell({
  professionalId,
  children,
}: {
  professionalId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const base = `/pro/${professionalId}`;

  const links: ProLink[] = [
    { href: base, label: "Dashboard", icon: "dashboard" },
    { href: `${base}/listings`, label: "Listings", icon: "listing" },
    { href: `${base}/leads`, label: "Leads", icon: "leads" },
    {
      href: `${base}/developments`,
      label: "Developments",
      icon: "developments",
    },
    { href: `${base}/team`, label: "Team", icon: "team" },
    {
      href: `${base}/promotions`,
      label: "Promotions",
      icon: "promotions",
    },
    { href: `${base}/voice`, label: "Voice", icon: "voice" },
  ];

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });

    try {
      localStorage.removeItem("nesafric.activeMarketplaceProfessionalId");
      localStorage.removeItem("propertyos.activeOrganisationId");
    } catch {
      // Best effort only.
    }

    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-warm-white text-ink">
      <ProfessionalSidebar
        base={base}
        links={links}
        pathname={pathname}
        onNavigate={() => setMobileOpen(false)}
        onSignOut={() => void signOut()}
      />

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-forest-deep/60"
            onClick={() => setMobileOpen(false)}
            type="button"
          />

          <div className="relative h-full w-fit shadow-2xl">
            <ProfessionalSidebar
              base={base}
              links={links}
              mobile
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              onSignOut={() => void signOut()}
            />
          </div>
        </div>
      )}

      <div className="min-h-screen lg:pl-[258px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-hairline bg-warm-white/95 px-4 backdrop-blur lg:h-[78px] lg:px-8 xl:px-10">
          <button
            aria-label="Open navigation"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-white text-forest lg:hidden"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <div className="hidden w-full max-w-md lg:block">
            <div className="relative">
              <svg
                aria-hidden="true"
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="6" />
                <path d="m16 16 4 4" />
              </svg>

              <input
                aria-label="Search professional workspace"
                className="h-10 w-full rounded-xl border border-hairline bg-white pl-10 pr-4 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/10"
                placeholder="Search listings, leads, developments..."
                type="search"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-ink">
                Professional Workspace
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                Marketplace &amp; Sales
              </p>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-forest text-xs font-bold text-white">
              P
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          <div className="mx-auto w-full max-w-[1500px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
