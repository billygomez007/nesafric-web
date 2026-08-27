/**
 * Single source of truth for customer-facing brand identity: name, domain, logo assets, contact
 * details, and transactional-email sender identities. Centralized so the brand migration touches
 * one file instead of scattering literals across every page/component/email template.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://umoafric.com").replace(/\/$/, "");

export const BRAND = {
  name: "UmoAfric",
  tagline: "Everything Property.",
  domain: "umoafric.com",
  siteUrl: SITE_URL,

  logo: {
    /**
     * Relative paths — used directly in on-site `<img>`/`next/image` tags. Email HTML needs
     * absolute, publicly-fetchable URLs instead: wrap these in `absoluteUrl()` when building
     * an email template.
     *
     * Both variants are the same artwork (navy symbol + turquoise "o"), rendered on a fully
     * transparent background — `onDark` has the navy ink recolored to white so it reads on
     * dark surfaces. Both share identical dimensions.
     */
    /** For light surfaces (marketing pages, auth, light app shells): navy symbol + turquoise "o". */
    onLight: "/brand/umo-afric-logo-navy.png",
    /** For dark surfaces (navy header/footer, dark hero sections): white symbol + turquoise "o". */
    onDark: "/brand/umo-afric-logo-white.png",
    /** Square white-rounded mark, source for favicon/apple-touch-icon/social. */
    square: "/brand/umo-afric-mark-square.png",
    og: "/brand/umo-afric-og.png",
    width: 2010,
    height: 648,
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
    hello: "UmoAfric <hello@umoafric.com>",
    notifications: "UmoAfric <notifications@umoafric.com>",
    support: "UmoAfric <support@umoafric.com>",
    info: "UmoAfric <info@umoafric.com>",
  },
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
