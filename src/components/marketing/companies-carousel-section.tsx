"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompaniesCarouselTrack, type CompanyCarouselItem } from "@/components/marketing/companies-carousel-track";

/** Ecosystem trust signal: real, active marketplace professionals only — never fabricated.
 * Fetched client-side from the existing public directory API (same one `MarketplaceDirectory`
 * uses) so the marketing homepage stays a static, DB-free build artifact rather than depending
 * on a live database connection at prerender time. Collapses entirely on zero results or if the
 * fetch fails — a trust section with nothing real to show, or that can't confirm it has
 * something real to show, should show nothing. */
export function CompaniesCarouselSection() {
  const [items, setItems] = useState<CompanyCarouselItem[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/marketplace-directory?page=1&pageSize=16", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json();
        setItems(body.items ?? []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section aria-labelledby="companies-heading" className="border-y border-hairline bg-white py-12 sm:py-16">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4 px-5 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-[-0.015em] text-forest-deep sm:text-[28px]" id="companies-heading">
          Companies and professionals on NesAfric
        </h2>
        <Link className="text-sm font-semibold text-forest hover:underline" href="/marketplace/professionals">
          View all <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="mt-6">
        <CompaniesCarouselTrack
          items={items.map((item) => ({
            slug: item.slug,
            displayName: item.displayName,
            type: item.type,
            logoUrl: item.logoUrl,
            verificationStatus: item.verificationStatus,
          }))}
        />
      </div>
    </section>
  );
}
