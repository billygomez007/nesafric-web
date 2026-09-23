"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";

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
    <header className="sticky top-0 z-50 border-b border-hairline/80 bg-warm-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
        <Link href="/"><BrandLogo height={34} variant="light" /></Link>
        <nav className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((link, index) => <Link className={`text-[13px] font-medium transition-colors hover:text-forest ${index === 0 ? "text-forest" : "text-muted"}`} href={link.href} key={link.label}>{link.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-full text-forest hover:bg-cream" href="/marketplace/properties"><span aria-hidden="true" className="text-lg">⌕</span></Link>
          <Link className="rounded-xl px-4 py-2.5 text-[13px] font-semibold text-forest hover:bg-cream" href="/login">Sign In</Link>
          <Link className="rounded-xl bg-forest px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald" href="/register">Get Started <span aria-hidden="true">→</span></Link>
        </div>
        <button aria-expanded={open} aria-label="Toggle navigation" className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline text-forest lg:hidden" onClick={() => setOpen(value => !value)} type="button"><span aria-hidden="true" className="text-xl">{open ? "×" : "☰"}</span></button>
      </div>
      {open && <div className="border-t border-hairline bg-warm-white px-5 py-5 lg:hidden"><nav className="grid gap-1">{NAV_LINKS.map(link => <Link className="rounded-lg px-3 py-3 text-sm font-medium text-forest hover:bg-cream" href={link.href} key={link.label} onClick={() => setOpen(false)}>{link.label}</Link>)}</nav><div className="mt-4 grid gap-2 border-t border-hairline pt-4"><Link className="rounded-lg px-3 py-3 text-center text-sm font-semibold text-forest" href="/login">Sign In</Link><Link className="rounded-xl bg-forest px-4 py-3 text-center text-sm font-semibold text-white" href="/register">Get Started</Link></div></div>}
    </header>
  );
}
