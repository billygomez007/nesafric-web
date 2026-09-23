/**
 * Single source of truth for customer-facing brand identity: name, domain, logo assets, contact
 * details, and transactional-email sender identities.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nesafric.com").replace(/\/$/, "");

export const BRAND = {
  name: "NesAfric",
  tagline: "The Operating System for Real Estate",
  domain: "nesafric.com",
  siteUrl: SITE_URL,

  logo: {
    /** Official five-part NesAfric identity supplied September 2026. */
    onLight: "/brand/nesafric-official-logo.png",
    onDark: "/brand/nesafric-official-logo.png",
    square: "/brand/nesafric-official-mark.png",
    og: "/brand/nesafric-official-logo.png",
    width: 2048,
    height: 682,
  },

  contact: {
    /** Formal corporate contact — company information, administrative enquiries. */
    info: "info@nesafric.com",
    /** General relationship/customer communication, welcome messages, enquiries. */
    hello: "hello@nesafric.com",
    /** Primary automated transactional sender — the default for platform-generated notifications. */
    notifications: "notifications@nesafric.com",
    /** Customer support, help, escalation — the reply destination for automated notifications. */
    support: "support@nesafric.com",
    phoneDisplay: "+233 (0) 50 282 0005",
    phoneTel: "+233502820005",
    address: "Plot 16, Atlantic Towers, Accra",
  },

  /** RFC 5322 "display name <address>" sender identities, mapped to their intended purpose. */
  sender: {
    hello: "NesAfric <hello@nesafric.com>",
    notifications: "NesAfric <notifications@nesafric.com>",
    support: "NesAfric <support@nesafric.com>",
    info: "NesAfric <info@nesafric.com>",
  },
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
