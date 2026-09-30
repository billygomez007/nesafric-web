"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

type ProviderIcon =
  | "dashboard"
  | "profile"
  | "verification"
  | "jobs"
  | "availability";

function Icon({ name }: { name: ProviderIcon }) {
  const paths: Record<ProviderIcon, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    profile: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="11" r="2.5" />
        <path d="M5.5 17c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7M15 10h3M15 13h3" />
      </>
    ),
    verification: (
      <>
        <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    jobs: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M8 6V4h8v2M3 11h18M9 14h6" />
      </>
    ),
    availability: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
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

type ProviderLink = {
  href: string;
  label: string;
  icon: ProviderIcon;
};

function isProviderRouteActive(
  pathname: string,
  base: string,
  href: string,
) {
  return href === base
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function ProviderSidebar({
  base,
  links,
  pathname,
  providerName,
  mobile = false,
  onNavigate,
}: {
  base: string;
  links: ProviderLink[];
  pathname: string;
  providerName: string;
  mobile?: boolean;
  onNavigate: () => void;
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
        <Link
          aria-label="NesAfric service provider workspace home"
          href={base}
          onClick={onNavigate}
        >
          <BrandLogo className="max-w-[150px]" height={34} variant="dark" />
        </Link>
      </div>

      <div className="border-b border-white/10 px-4 py-4">
        <WorkspaceSwitcher
          current={{
            kind: "service_provider",
            label: providerName,
          }}
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
          Service Provider workspace
        </p>

        <div className="space-y-0.5">
          {links.map((link) => {
            const active = isProviderRouteActive(
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

        <div className="mt-6 border-t border-white/10 pt-4">
          <Link
            className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.07] hover:text-white"
            href="/marketplace/services"
            onClick={onNavigate}
          >
            View Property Services marketplace
          </Link>
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <Link
          className="flex items-center justify-center rounded-lg border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs font-semibold text-gold-light"
          href="/dashboard"
          onClick={onNavigate}
        >
          Property management
        </Link>
      </div>
    </aside>
  );
}

export function ProviderWorkspaceShell({
  providerId,
  providerName,
  children,
}: {
  providerId: string;
  providerName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const base = `/providers/${providerId}`;

  /*
   * Only expose destinations that already have a real web capability.
   * Profile, verification and availability currently live on the provider
   * detail workspace. Jobs has its own owner-safe API and page destination.
   */
  const links: ProviderLink[] = [
    { href: base, label: "Dashboard", icon: "dashboard" },
    { href: `${base}/profile`, label: "Profile", icon: "profile" },
    {
      href: `${base}/verification`,
      label: "Verification",
      icon: "verification",
    },
    { href: `${base}/jobs`, label: "Jobs", icon: "jobs" },
    {
      href: `${base}/availability`,
      label: "Availability",
      icon: "availability",
    },
  ];

  return (
    <div className="min-h-screen bg-surface">
      <ProviderSidebar
        base={base}
        links={links}
        onNavigate={() => undefined}
        pathname={pathname}
        providerName={providerName}
      />

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close provider navigation"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <div className="relative h-full w-fit">
            <ProviderSidebar
              base={base}
              links={links}
              mobile
              onNavigate={() => setMobileOpen(false)}
              pathname={pathname}
              providerName={providerName}
            />
          </div>
        </div>
      )}

      <div className="lg:pl-[258px]">
        <header className="sticky top-0 z-30 flex min-h-[64px] items-center gap-3 border-b border-hairline bg-white/95 px-4 backdrop-blur lg:hidden">
          <button
            aria-label="Open provider navigation"
            className="rounded-lg border border-hairline px-3 py-2 text-sm font-semibold text-forest"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            Menu
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-forest">
              {providerName}
            </p>
            <p className="text-xs text-muted">Service Provider workspace</p>
          </div>
        </header>

        <main className="min-h-screen">{children}</main>
      </div>
    </div>
  );
}
