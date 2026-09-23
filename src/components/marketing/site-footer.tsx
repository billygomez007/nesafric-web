import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND } from "@/platform/brand";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "/#product", label: "Operating system" },
      { href: "/properties", label: "Property management" },
      { href: "/payments", label: "Payments" },
      { href: "/marketplace", label: "Marketplace" },
    ],
  },
  {
    title: "For Real Estate",
    links: [
      { href: "/for-professionals", label: "Professionals" },
      { href: "/for-developers", label: "Developers" },
      { href: "/for-property-owners", label: "Property owners" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Explore",
    links: [
      { href: "/marketplace/properties", label: "Browse properties" },
      { href: "/marketplace/professionals", label: "Find a professional" },
      { href: "/ghana", label: "Ghana launch" },
      { href: "/register", label: "Get started" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms & conditions" },
      { href: "/cookies", label: "Cookie policy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-[#081f1d] text-white">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-gold/10" />
      <div className="pointer-events-none absolute right-10 top-16 h-40 w-40 rounded-full border border-white/[0.05]" />

      <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-16">
        <div className="mb-12 grid gap-8 rounded-[28px] border border-white/10 bg-white/[0.035] p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-soft">NesAfric</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
              One connected platform for the business of real estate in Africa.
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link
              className="rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-forest-deep transition hover:bg-gold-soft"
              href="/register"
            >
              Get started →
            </Link>
            <Link
              className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              href="/marketplace/properties"
            >
              Explore marketplace
            </Link>
          </div>
        </div>

        <div className="grid gap-12 border-b border-white/10 pb-12 lg:grid-cols-[1.35fr_repeat(4,1fr)]">
          <div>
            <BrandLogo height={28} />
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/58">
              The operating system for African real estate. Manage property, money, people and opportunities from one connected platform.
            </p>

            <div className="mt-7 space-y-2 text-sm text-white/55">
              <p>
                <a className="transition hover:text-gold-soft" href={`mailto:${BRAND.contact.hello}`}>
                  {BRAND.contact.hello}
                </a>
              </p>
              <p>
                <a className="transition hover:text-gold-soft" href={`mailto:${BRAND.contact.support}`}>
                  {BRAND.contact.support}
                </a>
              </p>
              <p>
                <a className="transition hover:text-gold-soft" href={`tel:${BRAND.contact.phoneTel}`}>
                  {BRAND.contact.phoneDisplay}
                </a>
              </p>
              <p className="pt-1 text-xs leading-5 text-white/38">{BRAND.contact.address}</p>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/82">{column.title}</p>
              <ul className="mt-5 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className="text-sm text-white/52 transition hover:text-gold-soft" href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 pt-7 text-xs text-white/38 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="transition hover:text-white" href="/privacy">Privacy</Link>
            <Link className="transition hover:text-white" href="/terms">Terms</Link>
            <Link className="transition hover:text-white" href="/cookies">Cookies</Link>
            <a className="transition hover:text-white" href={`mailto:${BRAND.contact.info}`}>Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
