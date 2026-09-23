"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND } from "@/platform/brand";

const NAV_LINKS = [
  { href: "/#product", label: "Platform" },
  { href: "/for-property-owners", label: "Solutions" },
  { href: "/marketplace/properties", label: "Marketplace" },
  { href: "/#resources", label: "Resources" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-forest-deep/97 text-white backdrop-blur-xl">
      <div className="border-b border-white/[0.07] bg-[#062b27]">
        <div className="mx-auto flex min-h-7 max-w-[1400px] items-center justify-between gap-4 px-5 py-1 text-[11px] text-white/58 sm:px-8">
          <a
            className="hidden tracking-[0.01em] transition-colors hover:text-white sm:inline"
            href={`mailto:${BRAND.contact.support}`}
          >
            {BRAND.contact.support}
          </a>
          <span aria-hidden="true" className="hidden flex-1 sm:block" />
          <a
            className="font-medium tracking-[0.01em] text-white/70 transition-colors hover:text-white"
            href={`tel:${BRAND.contact.phoneTel}`}
          >
            {BRAND.contact.phoneDisplay}
          </a>
        </div>
      </div>

      <div className="mx-auto flex h-[70px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
        <Link className="shrink-0" href="/">
          <BrandLogo height={32} variant="dark" />
        </Link>

        <nav className="hidden items-center gap-9 lg:flex">
          {NAV_LINKS.map((link, index) => (
            <Link
              className={`relative py-2 text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                index === 0 ? "text-white" : "text-white/66 hover:text-white"
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
            className="px-3 py-2.5 text-[13px] font-medium text-white/72 transition-colors hover:text-white"
            href="/login"
          >
            Sign In
          </Link>

          <Link
            className="rounded-lg bg-gold px-5 py-2.5 text-[13px] font-semibold text-forest-deep transition-colors hover:bg-gold-soft"
            href="/register"
          >
            Start with NesAfric <span aria-hidden="true">→</span>
          </Link>
        </div>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/12 text-white transition hover:bg-white/[0.06] lg:hidden"
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
              Start with NesAfric
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
