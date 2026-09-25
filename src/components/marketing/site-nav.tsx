"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { buttonClass } from "@/components/ui/button-styles";

const NAV_LINKS = [
  { href: "/#product", label: "Platform", match: (path: string) => path === "/" },
  { href: "/for-property-owners", label: "Property owners", match: (path: string) => path.startsWith("/for-property-owners") },
  { href: "/for-professionals", label: "Professionals", match: (path: string) => path.startsWith("/for-professionals") },
  { href: "/for-developers", label: "Developers", match: (path: string) => path.startsWith("/for-developers") },
  { href: "/marketplace/properties", label: "Marketplace", match: (path: string) => path.startsWith("/marketplace") },
  { href: "/pricing", label: "Pricing", match: (path: string) => path.startsWith("/pricing") },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape closes the mobile menu and returns focus to the toggle that opened it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-forest-deep text-white">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-5 sm:px-8 lg:h-[72px] xl:gap-6">
        <Link aria-label="NesAfric home" className="shrink-0" href="/">
          <BrandLogo height={30} variant="dark" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-5 lg:flex xl:gap-7">
          {NAV_LINKS.map((link) => {
            const active = link.match(pathname);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`font-display relative whitespace-nowrap py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "text-white after:absolute after:inset-x-0 after:-bottom-[1px] after:h-px after:bg-gold"
                    : "text-white/70 hover:text-white"
                }`}
                href={link.href}
                key={link.label}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link className="font-display whitespace-nowrap px-3 py-2 text-[13px] font-medium text-white/75 transition-colors hover:text-white" href="/login">
            Sign in
          </Link>
          <Link className={buttonClass("primaryOnDark", "sm")} href="/register">
            Start with NesAfric
          </Link>
        </div>

        <button
          aria-controls="site-nav-mobile"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-white/15 text-white transition hover:bg-white/[0.06] lg:hidden"
          onClick={() => setOpen((value) => !value)}
          ref={toggleRef}
          type="button"
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-forest-deep px-5 pb-6 pt-2 lg:hidden" id="site-nav-mobile">
          <nav aria-label="Main" className="grid">
            {NAV_LINKS.map((link) => (
              <Link
                aria-current={link.match(pathname) ? "page" : undefined}
                className="font-display flex min-h-12 items-center border-b border-white/[0.08] text-[15px] font-medium text-white/85 transition hover:text-white"
                href={link.href}
                key={link.label}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link className={buttonClass("secondaryOnDark")} href="/login" onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link className={buttonClass("primaryOnDark")} href="/register" onClick={() => setOpen(false)}>
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
