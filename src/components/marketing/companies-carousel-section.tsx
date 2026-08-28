"use client";

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
    <section aria-label="Companies and professionals on UmoAfric" className="border-b border-slate-200 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 text-center sm:px-8">
        <p className="text-xs font-semibold tracking-[0.22em] text-navy">TRUSTED REAL ESTATE PROFESSIONALS ON UMOAFRIC</p>
      </div>
      <div className="mt-8">
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
