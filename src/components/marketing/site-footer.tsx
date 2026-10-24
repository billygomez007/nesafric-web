import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { BRAND, whatsappChatUrl } from "@/platform/brand";

const COLUMNS = [
  {
    title: "Marketplace",
    links: [
      { href: "/marketplace/properties?listingType=RENT", label: "Property to rent" },
      { href: "/marketplace/properties?listingType=SALE", label: "Property for sale" },
      { href: "/marketplace/properties?category=LAND", label: "Land" },
      { href: "/marketplace/professionals", label: "Agents and companies" },
      { href: "/marketplace/services", label: "Service providers" },
    ],
  },
  {
    title: "For business",
    links: [
      { href: "/platform", label: "The NesAfric platform" },
      { href: "/for-property-owners", label: "Property owners and managers" },
      { href: "/for-professionals", label: "Agents and brokers" },
      { href: "/for-developers", label: "Developers" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/ghana", label: "Ghana launch" },
      { href: "/register", label: "Get started" },
      { href: "/login", label: "Sign in" },
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
    <footer className="border-t border-white/10 bg-forest-deep text-white">
      <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8 sm:py-16">
        <div className="grid gap-12 border-b border-white/10 pb-12 lg:grid-cols-[1.35fr_repeat(4,1fr)]">
          <div>
            <BrandLogo height={28} />
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/65">
              Find property across Ghana — on the operating system for real estate, built in Accra for property businesses in Ghana and across Africa.
            </p>

            <div className="mt-7 space-y-2 text-sm text-white/65">
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
              <p>
                <a className="transition hover:text-gold-soft" href={whatsappChatUrl("Hi NesAfric")} target="_blank" rel="noopener noreferrer">
                  WhatsApp {BRAND.contact.whatsappDisplay}
                </a>
              </p>
              <p className="pt-1 text-xs leading-5 text-white/55">{BRAND.contact.address}</p>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="font-display text-sm font-semibold text-white">{column.title}</p>
              <ul className="mt-5 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className="text-sm text-white/65 transition hover:text-white" href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 pt-7 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
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
