"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/marketplace/properties", label: "Properties" },
  { href: "/marketplace/professionals", label: "Professionals" },
  { href: "/marketplace", label: "Service providers", exact: true },
  { href: "/marketplace/requests", label: "My requests" },
];

/** Section navigation for the public marketplace. Scrolls sideways on small screens rather than
 * wrapping onto several lines. */
export function MarketplaceSubnav() {
  const pathname = usePathname() ?? "";

  return (
    <div className="border-b border-hairline bg-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-5 sm:px-8">
        <nav aria-label="Marketplace" className="-mx-1 flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
          {LINKS.map((link) => {
            const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-12 shrink-0 items-center px-3 text-sm font-medium transition-colors ${
                  active ? "text-forest-deep after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-forest" : "text-muted hover:text-forest"
                }`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <Link className="hidden shrink-0 text-sm font-semibold text-forest hover:text-emerald sm:inline" href="/listings">
          List a property
        </Link>
      </div>
    </div>
  );
}
