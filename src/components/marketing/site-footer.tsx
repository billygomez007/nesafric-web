import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND } from "@/platform/brand";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "#operating-system", label: "Operating system" },
      { href: "#ai-employees", label: "AI employees" },
      { href: "#payments", label: "Payments" },
      { href: "#lifecycle", label: "Property lifecycle" },
    ],
  },
  {
    title: "For Real Estate",
    links: [
      { href: "/for-professionals", label: "For Professionals" },
      { href: "/for-developers", label: "For Developers" },
      { href: "/for-property-owners", label: "For Property Owners" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Marketplace",
    links: [
      { href: "/marketplace/properties", label: "Browse properties" },
      { href: "/marketplace/professionals", label: "Find a professional" },
      { href: "/ghana", label: "Ghana Launch" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Get started" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <BrandLogo height={26} />
            <p className="mt-4 max-w-xs text-sm leading-6 text-slate-400">
              The intelligent operating and marketplace platform for real estate.
            </p>
            <dl className="mt-6 space-y-3 text-sm text-slate-400">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">General enquiries</dt>
                <dd><a className="transition-colors hover:text-white" href={`mailto:${BRAND.contact.hello}`}>{BRAND.contact.hello}</a></dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Support</dt>
                <dd><a className="transition-colors hover:text-white" href={`mailto:${BRAND.contact.support}`}>{BRAND.contact.support}</a></dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Corporate</dt>
                <dd><a className="transition-colors hover:text-white" href={`mailto:${BRAND.contact.info}`}>{BRAND.contact.info}</a></dd>
              </div>
              <div>
                <a className="transition-colors hover:text-white" href={`tel:${BRAND.contact.phoneTel}`}>{BRAND.contact.phoneDisplay}</a>
              </div>
              <div className="text-slate-500">{BRAND.contact.address}</div>
            </dl>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-semibold text-white">{column.title}</p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className="text-sm text-slate-400 transition-colors hover:text-white" href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col gap-4 border-t border-slate-800 pt-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {BRAND.name}. All rights reserved. · <a className="hover:text-slate-300" href={`https://${BRAND.domain}`}>{BRAND.domain}</a></p>
          <p>Built for owners, operators, agents, brokers, brokerages and developers.</p>
        </div>
      </div>
    </footer>
  );
}
