import type { Metadata } from "next";
import Link from "next/link";
import { PublicListingDetail } from "@/components/public-listing-detail";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";
import { getPublicListing } from "@/modules/listings/service";
import { photosCoverFirst } from "@/lib/listing-cover";
import { listingLocation } from "@/lib/listing-display";
import { absoluteUrl } from "@/platform/brand";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>;
}): Promise<Metadata> {
  const { listingId } = await params;

  try {
    const { listing } = await getPublicListing(listingId);
    const [cover] = photosCoverFirst(listing.media);

    const title = listing.title;
    const location = listingLocation(listing.location);

    const description =
      listing.description?.trim().slice(0, 180) ||
      `${title}${location ? ` in ${location}` : ""} on NesAfric.`;

    const canonical = absoluteUrl(`/marketplace/properties/${listing.id}`);

    return {
      title,
      description,
      alternates: {
        canonical,
      },
      openGraph: {
        type: "website",
        siteName: "NesAfric",
        title,
        description,
        url: canonical,
        images: cover
          ? [
              {
                url: cover.url,
                alt: cover.altText ?? cover.title ?? title,
              },
            ]
          : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: cover ? [cover.url] : undefined,
      },
    };
  } catch {
    return {
      title: "Property on NesAfric",
      description: "View this property on NesAfric.",
    };
  }
}

export default async function PublicListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />
      <main className="min-h-screen bg-warm-white">
        <div className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-10">
          <Link
            className="mb-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest hover:underline"
            href="/marketplace/properties"
          >
            <span aria-hidden="true">←</span> All properties
          </Link>
          <PublicListingDetail listingId={listingId} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
