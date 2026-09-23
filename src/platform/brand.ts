/**
 * Single source of truth for customer-facing brand identity: name, domain, logo assets, contact
 * details, and transactional-email sender identities. Centralized so the brand migration touches
 * one file instead of scattering literals across every page/component/email template.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://nesafric.com").replace(/\/$/, "");

export const BRAND = {
  name: "NesAfric",
  tagline: "Real Estate OS for Africa",
  domain: "nesafric.com",
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
    onLight: "/brand/nesafric-wordmark.png",
    /** For dark surfaces (navy header/footer, dark hero sections): white symbol + turquoise "o". */
    onDark: "/brand/nesafric-wordmark.png",
    /** Square white-rounded mark, source for favicon/apple-touch-icon/social. */
    square: "/brand/umo-afric-mark-square.png",
    og: "/brand/nesafric-wordmark.png",
    width: 2172,
    height: 724,
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
