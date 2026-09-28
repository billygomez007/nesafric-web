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
    /** Official NesAfric logo supplied 2026-09-28. Source: `brand/nesafric-logo.png`; every file
     * here is generated from it by `scripts/generate-brand-assets.mjs`. */
    onLight: "/brand/nesafric-logo.png",
    onDark: "/brand/nesafric-logo.png",
    /** The logo's own house mark, for square slots (PWA icon). */
    square: "/brand/nesafric-mark.png",
    /** 1200 x 630 social card: the full logo on the brand canvas. */
    og: "/brand/nesafric-og.png",
    /** Intrinsic size of `onLight`/`onDark`, for aspect-correct rendering. */
    width: 2046,
    height: 567,
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
