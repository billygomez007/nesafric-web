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

const SITEMAP_LOOKUP_TIMEOUT_MS = 5000;

async function withSitemapTimeout(
  label: string,
  operation: Promise<Entry[]>,
): Promise<Entry[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<Entry[]>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `sitemap: ${label} lookup exceeded ${SITEMAP_LOOKUP_TIMEOUT_MS}ms; omitting dynamic entries from this generation`,
      );
      resolve([]);
    }, SITEMAP_LOOKUP_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    console.error(
      `sitemap: failed to load ${label}, omitting from this generation`,
      error,
    );
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  { url: `${BRAND.siteUrl}/platform`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${BRAND.siteUrl}/marketplace/services`, changeFrequency: "daily", priority: 0.8 },
  { url: `${BRAND.siteUrl}/marketplace/properties`, changeFrequency: "daily", priority: 0.9 },
  { url: `${BRAND.siteUrl}/marketplace/professionals`, changeFrequency: "daily", priority: 0.9 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dynamicEntries = await Promise.all([
    withSitemapTimeout(
      "public listings",
      listPublicListingsForSitemap().then((listings) =>
        listings.map(
          (listing): Entry => ({
            url: `${BRAND.siteUrl}/marketplace/properties/${listing.id}`,
            lastModified: listing.updatedAt,
            changeFrequency: "daily",
            priority: 0.7,
          }),
        ),
      ),
    ),

    withSitemapTimeout(
      "marketplace professionals",
      listPublicMarketplaceProfessionalsForSitemap().then((professionals) =>
        professionals.map(
          (professional): Entry => ({
            url: `${BRAND.siteUrl}/marketplace/professionals/${professional.slug}`,
            lastModified: professional.updatedAt,
            changeFrequency: "weekly",
            priority: 0.6,
          }),
        ),
      ),
    ),

    withSitemapTimeout(
      "service providers",
      listPublicServiceProvidersForSitemap().then((providers) =>
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
      ),
    ),
  ]);

  return [...STATIC_ENTRIES, ...dynamicEntries.flat()];
}
