"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompaniesCarouselTrack, type CompanyCarouselItem } from "@/components/marketing/companies-carousel-track";
import { buttonClass } from "@/components/ui/button-styles";

/** Ecosystem trust signal: real, active and VERIFIED marketplace professionals only — never
 * fabricated, and never unverified profiles simply because they exist.
 * Fetched client-side from the existing public directory API (same one `MarketplaceDirectory`
 * uses) so the marketing homepage stays a static, DB-free build artifact rather than depending
 * on a live database connection at prerender time. By default it collapses entirely on zero results
 * or if the fetch fails. With `emptyState` (the marketplace homepage) the section stays in place
 * and, with nothing verified to show, says so and invites professionals to get verified — it
 * never shows placeholder names or logos. */
export function CompaniesCarouselSection({ emptyState = false }: { emptyState?: boolean }) {
  const [items, setItems] = useState<CompanyCarouselItem[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/marketplace-directory?page=1&pageSize=16&verifiedOnly=true", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) { if (emptyState) setItems([]); return; }
        const body = await response.json();
        setItems(body.items ?? []);
      })
      .catch(() => { if (emptyState && !controller.signal.aborted) setItems([]); });
    return () => controller.abort();
  }, [emptyState]);

  if (!emptyState && (!items || items.length === 0)) return null;
  const hasItems = !!items && items.length > 0;

  return (
    <section aria-labelledby="companies-heading" className="border-y border-hairline bg-white py-12 sm:py-16">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4 px-5 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-[-0.015em] text-forest-deep sm:text-[28px]" id="companies-heading">
          Companies and professionals on NesAfric
        </h2>
        {hasItems && (
          <Link className="text-sm font-semibold text-forest hover:underline" href="/marketplace/professionals">
            View all <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      <div className="mt-6">
        {hasItems ? (
          <CompaniesCarouselTrack
            items={items.map((item) => ({
              slug: item.slug,
              displayName: item.displayName,
              type: item.type,
              logoUrl: item.logoUrl,
              verificationStatus: item.verificationStatus,
            }))}
          />
        ) : items ? (
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
            <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-dashed border-hairline bg-warm-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6" data-testid="companies-empty">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-media)] bg-white text-gold-ink ring-1 ring-hairline">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-forest-deep">Verified companies will appear here</p>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-muted">Agents, brokerages and developers are shown once NesAfric has verified who they are.</p>
                </div>
              </div>
              <Link className={`${buttonClass("secondary", "sm")} shrink-0 self-start sm:self-center`} href="/for-professionals">Get verified</Link>
            </div>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading companies" className="mx-auto h-[58px] max-w-[1400px] px-5 sm:px-8" role="status">
            <div className="h-full rounded-[var(--radius-panel)] bg-surface/70" />
          </div>
        )}
      </div>
    </section>
  );
}
