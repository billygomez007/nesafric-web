/**
 * Single source of truth for customer-facing brand identity: name, domain, logo assets, contact
 * details, and transactional-email sender identities. Centralized so the brand migration touches
 * one file instead of scattering literals across every page/component/email template.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://umoafric.com").replace(/\/$/, "");

export const BRAND = {
  name: "Umo Afric",
  tagline: "Everything Property.",
  domain: "umoafric.com",
  siteUrl: SITE_URL,

  logo: {
    /**
     * Relative paths — used directly in on-site `<img>`/`next/image` tags. Email HTML needs
     * absolute, publicly-fetchable URLs instead: wrap these in `absoluteUrl()` when building
     * an email template.
     */
    /** For dark surfaces (marketing header/footer, dark hero sections): transparent background. */
    onDark: "/brand/umo-afric-logo.png",
    /** For light surfaces (authenticated app shells): same artwork on a dark rounded chip. */
    onLight: "/brand/umo-afric-logo-chip.png",
    /** Square dark-canvas mark, source for favicon/apple-touch-icon/social. */
    square: "/brand/umo-afric-mark-square.png",
    og: "/brand/umo-afric-og.png",
    width: 1454,
    height: 374,
  },

  contact: {
    /** Formal corporate contact — company information, administrative enquiries. */
    info: "info@umoafric.com",
    /** General relationship/customer communication, welcome messages, enquiries. */
    hello: "hello@umoafric.com",
    /** Primary automated transactional sender — the default for platform-generated notifications. */
    notifications: "notifications@umoafric.com",
    /** Customer support, help, escalation — the reply destination for automated notifications. */
    support: "support@umoafric.com",
    phoneDisplay: "+233 (0) 50 282 0005",
    phoneTel: "+233502820005",
    address: "Plot 16, Atlantic Towers, Accra",
  },

  /** RFC 5322 "display name <address>" sender identities, mapped to their intended purpose. */
  sender: {
    hello: "Umo Afric <hello@umoafric.com>",
    notifications: "Umo Afric <notifications@umoafric.com>",
    support: "Umo Afric <support@umoafric.com>",
    info: "Umo Afric <info@umoafric.com>",
  },
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
