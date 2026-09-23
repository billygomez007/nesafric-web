"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND } from "@/platform/brand";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/#product", label: "Product" },
  { href: "/for-property-owners", label: "Solutions" },
  { href: "/marketplace/properties", label: "Marketplace" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#resources", label: "Resources" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gold/20 bg-forest-deep/95 text-white shadow-[0_10px_30px_rgba(0,47,43,0.10)] backdrop-blur-xl">
      <div className="border-b border-white/8 bg-[#052724]">
        <div className="mx-auto flex min-h-8 max-w-[1400px] items-center justify-end gap-4 px-5 py-1.5 text-[11px] text-white/62 sm:px-8">
          <a
            className="hidden transition-colors hover:text-gold-soft sm:inline"
            href={`mailto:${BRAND.contact.support}`}
          >
            {BRAND.contact.support}
          </a>
          <span aria-hidden="true" className="hidden h-3 w-px bg-white/15 sm:block" />
          <a
            className="font-medium tracking-[0.01em] text-white/76 transition-colors hover:text-gold-soft"
            href={`tel:${BRAND.contact.phoneTel}`}
          >
            {BRAND.contact.phoneDisplay}
          </a>
        </div>
      </div>

      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
        <Link className="shrink-0" href="/">
          <BrandLogo height={34} variant="dark" />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((link, index) => (
            <Link
              className={`relative py-2 text-[13px] font-medium transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:mx-auto after:h-px after:w-0 after:bg-gold after:transition-all hover:text-white hover:after:w-full ${
                index === 0 ? "text-white" : "text-white/68"
              }`}
              href={link.href}
              key={link.label}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            aria-label="Search"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/72 transition hover:bg-white/10 hover:text-white"
            href="/marketplace/properties"
          >
            <span aria-hidden="true" className="text-lg">⌕</span>
          </Link>

          <Link
            className="rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white/82 transition hover:bg-white/10 hover:text-white"
            href="/login"
          >
            Sign In
          </Link>

          <Link
            className="rounded-xl bg-gold px-5 py-2.5 text-[13px] font-semibold text-forest-deep shadow-sm transition hover:bg-gold-soft"
            href="/register"
          >
            Get Started <span aria-hidden="true">→</span>
          </Link>
        </div>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:bg-white/10 lg:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span aria-hidden="true" className="text-xl">{open ? "×" : "☰"}</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-forest-deep px-5 py-5 lg:hidden">
          <div className="mb-4 grid gap-2 border-b border-white/10 pb-4 text-xs text-white/60">
            <a className="transition hover:text-gold-soft" href={`mailto:${BRAND.contact.support}`}>
              {BRAND.contact.support}
            </a>
            <a className="transition hover:text-gold-soft" href={`tel:${BRAND.contact.phoneTel}`}>
              {BRAND.contact.phoneDisplay}
            </a>
          </div>
          <nav className="grid gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                className="rounded-lg px-3 py-3 text-sm font-medium text-white/75 transition hover:bg-white/[0.07] hover:text-white"
                href={link.href}
                key={link.label}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mt-4 grid gap-2 border-t border-white/10 pt-4">
            <Link
              className="rounded-lg px-3 py-3 text-center text-sm font-semibold text-white/85 transition hover:bg-white/[0.07]"
              href="/login"
            >
              Sign In
            </Link>
            <Link
              className="rounded-xl bg-gold px-4 py-3 text-center text-sm font-semibold text-forest-deep transition hover:bg-gold-soft"
              href="/register"
            >
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
