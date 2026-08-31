import type { MetadataRoute } from "next";
import { BRAND } from "@/platform/brand";

// Defense in depth only — the routes below are already protected by session/authorization checks
// (see AppShell/MarketplaceProShell-wrapped pages and the platform-admin/API auth guards). This
// file exists to keep crawl budget on indexable content and keep low-value/authenticated pages out
// of search results; it is never the access-control mechanism for anything sensitive.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/login",
        "/register",
        "/onboarding",
        "/settings",
        "/dashboard",
        "/platform-admin",
        "/pro",
        "/properties",
        "/tenants",
        "/leases",
        "/leasing",
        "/payments",
        "/maintenance",
        "/providers",
        "/listings",
        "/inbox",
        "/ai",
        "/documents",
        "/team",
        "/deposits",
        "/receipts",
        "/webchat",
        // Personalized enquiry history for the signed-in organisation — empty/unusable for an
        // anonymous crawler, not indexable content.
        "/marketplace/requests",
      ],
    },
    sitemap: `${BRAND.siteUrl}/sitemap.xml`,
  };
}
