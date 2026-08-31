import type { MetadataRoute } from "next";
import { BRAND } from "@/platform/brand";
import { listPublicListingsForSitemap } from "@/modules/listings/service";
import { listPublicMarketplaceProfessionalsForSitemap } from "@/modules/marketplace-professionals/service";
import { listPublicServiceProvidersForSitemap } from "@/modules/marketplace/service";

// This route queries the database on every regeneration. Revalidating on an interval (instead of
// per-request) keeps published/verification changes visible to crawlers within the hour without
// hitting Postgres on every Googlebot fetch.
export const revalidate = 3600;

type Entry = MetadataRoute.Sitemap[number];

// Hand-written marketing/product pages that are public, indexable, and not gated behind
// authentication (`AppShell`/`MarketplaceProShell`) or an onboarding/auth flow. No `lastModified`
// is set for these: they're static route content with no tracked modification timestamp, and
// stamping `new Date()` at build/request time would misrepresent them as freshly changed.
const STATIC_ENTRIES: Entry[] = [
  { url: `${BRAND.siteUrl}/`, changeFrequency: "weekly", priority: 1 },
  { url: `${BRAND.siteUrl}/ghana`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${BRAND.siteUrl}/for-professionals`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${BRAND.siteUrl}/for-developers`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${BRAND.siteUrl}/for-property-owners`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${BRAND.siteUrl}/pricing`, changeFrequency: "monthly", priority: 0.7 },
  // Search/discovery landing pages: the content on them (listing and provider cards) changes as
  // often as the underlying marketplace data, so these are checked more frequently than static
  // marketing copy even though the page shell itself is static.
  { url: `${BRAND.siteUrl}/marketplace`, changeFrequency: "daily", priority: 0.9 },
  { url: `${BRAND.siteUrl}/marketplace/properties`, changeFrequency: "daily", priority: 0.9 },
  { url: `${BRAND.siteUrl}/marketplace/professionals`, changeFrequency: "daily", priority: 0.9 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dynamicEntries = await Promise.all([
    // Published, verified property listings for which the underlying unit/property is currently
    // available — anything else 404s on `/marketplace/properties/[listingId]` (see
    // `getPublicListing`), so this mirrors that exact eligibility check to avoid listing broken URLs.
    listPublicListingsForSitemap()
      .then((listings) =>
        listings.map(
          (listing): Entry => ({
            url: `${BRAND.siteUrl}/marketplace/properties/${listing.id}`,
            lastModified: listing.updatedAt,
            changeFrequency: "daily",
            priority: 0.7,
          }),
        ),
      )
      .catch((error) => {
        console.error("sitemap: failed to load public listings, omitting from this generation", error);
        return [];
      }),

    // Active, unarchived marketplace professionals (agents/brokers/brokerages/developers/etc.) —
    // same eligibility as `getPublicMarketplaceProfessionalProfile`.
    listPublicMarketplaceProfessionalsForSitemap()
      .then((professionals) =>
        professionals.map(
          (professional): Entry => ({
            url: `${BRAND.siteUrl}/marketplace/professionals/${professional.slug}`,
            lastModified: professional.updatedAt,
            changeFrequency: "weekly",
            priority: 0.6,
          }),
        ),
      )
      .catch((error) => {
        console.error("sitemap: failed to load marketplace professionals, omitting from this generation", error);
        return [];
      }),

    // Verified, non-suspended property service professionals who have opted into public listing
    // (`ProviderMarketplaceProfile.listed`) — same eligibility as `getPublicMarketplaceProvider`.
    // The canonical URL mirrors what the marketplace UI itself links to (`marketplace-search.tsx`):
    // `/marketplace/services/{slug}` when a slug exists, `/marketplace/{id}` otherwise — never both,
    // to avoid indexing the same profile at two URLs.
    listPublicServiceProvidersForSitemap()
      .then((providers) =>
        providers.map(
          (provider): Entry => ({
            url: provider.slug
              ? `${BRAND.siteUrl}/marketplace/services/${provider.slug}`
              : `${BRAND.siteUrl}/marketplace/${provider.id}`,
            lastModified: provider.updatedAt,
            changeFrequency: "weekly",
            priority: 0.6,
          }),
        ),
      )
      .catch((error) => {
        console.error("sitemap: failed to load service providers, omitting from this generation", error);
        return [];
      }),
  ]);

  return [...STATIC_ENTRIES, ...dynamicEntries.flat()];
}
