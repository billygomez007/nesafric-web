"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";

const NAV_LINKS = [
  { href: "/#manage", label: "Platform" },
  { href: "/marketplace/properties", label: "Marketplace" },
  { href: "/for-professionals", label: "For Professionals" },
  { href: "/for-developers", label: "For Developers" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-navy/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8">
        <Link className="flex items-center" href="/">
          <BrandLogo height={30} />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link className="text-sm font-medium text-slate-300 transition-colors hover:text-white" href={link.href} key={link.label}>
              {link.label}
            </Link>
          ))}
          <Link
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold tracking-wide text-brand transition-colors hover:border-brand/50"
            href="/ghana"
          >
            GHANA LAUNCH
          </Link>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link className="text-sm font-medium text-slate-300 transition-colors hover:text-white" href="/login">
            Sign In
          </Link>
          <Link
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-brand-hover"
            href="/register"
          >
            Get Started
          </Link>
        </div>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white lg:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-navy px-6 py-6 lg:hidden">
          <nav className="flex flex-col gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                className="text-base font-medium text-slate-200"
                href={link.href}
                key={link.label}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold tracking-wide text-brand"
              href="/ghana"
              onClick={() => setOpen(false)}
            >
              GHANA LAUNCH
            </Link>
          </nav>
          <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-6">
            <Link className="text-center text-sm font-semibold text-slate-200" href="/login" onClick={() => setOpen(false)}>
              Sign In
            </Link>
            <Link
              className="rounded-full bg-brand px-4 py-3 text-center text-sm font-semibold text-navy"
              href="/register"
              onClick={() => setOpen(false)}
            >
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
