"use client";

import { useState } from "react";
import type { PublicProvider } from "@/components/marketplace-search";
import { formatListingPrice } from "@/lib/listing-display";

/**
 * Presentation of a public provider's trust information for the web marketplace (cards and
 * profile), mirroring the native app. Every figure is displayed exactly as the server sent it:
 * nothing here computes a rating, a job count or a completion rate. Values the provider states
 * about itself (rate, response time, availability) are labelled as such, apart from NesAfric's
 * own record.
 */

export function providerTypeLabel(type: string) {
  return type === "COMPANY" ? "Company" : type === "INDIVIDUAL" ? "Individual" : null;
}

export function providerInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

type Area = PublicProvider["serviceAreas"][number];

export function formatServiceArea(area: Area) {
  if (area.label) return area.label;
  const parts = [area.district, area.city, area.region].filter(Boolean);
  return parts.length ? parts.join(", ") : area.countryCode === "GH" ? "Ghana" : area.countryCode;
}

/** "East Legon, Accra +2 areas"; null when the provider publishes no area. */
export function primaryServiceArea(provider: Pick<PublicProvider, "serviceAreas">) {
  const [first, ...rest] = provider.serviceAreas;
  if (!first) return null;
  return rest.length ? `${formatServiceArea(first)} +${rest.length} ${rest.length === 1 ? "area" : "areas"}` : formatServiceArea(first);
}

/** Only levels the server reports as reviewer-approved, in a fixed order. */
export function verificationBadgeLabels(provider: Pick<PublicProvider, "verificationBadges">) {
  const badges = provider.verificationBadges;
  if (!badges) return [];
  return [badges.identity && "Verified Identity", badges.business && "Verified Business", badges.skill && "Verified Professional"].filter(
    (label): label is string => typeof label === "string",
  );
}

/** Null without ratings — never a "5.0 (0)" or a placeholder score. */
export function ratingSummary(provider: Pick<PublicProvider, "aggregateRating" | "ratingCount">) {
  if (provider.aggregateRating === null || provider.ratingCount < 1) return null;
  return { score: provider.aggregateRating.toFixed(1), count: provider.ratingCount };
}

export function completedJobsLabel(count: number) {
  return `${count.toLocaleString("en")} ${count === 1 ? "job" : "jobs"} completed`;
}

/** The server's rate as a whole percentage; null (render nothing / a neutral note) otherwise. */
export function completionRatePercent(provider: Pick<PublicProvider, "completionRate">) {
  const rate = provider.completionRate;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? Math.round(rate * 100) : null;
}

/** Provider-stated: "From GH₵250"; null when not published. */
export function startingRateLabel(provider: Pick<PublicProvider, "pricing">) {
  const { startingRateMinor, currencyCode } = provider.pricing;
  return startingRateMinor && currencyCode ? `From ${formatListingPrice(startingRateMinor, currencyCode)}` : null;
}

/** Provider-stated: "Within 4 hours" / "Within 2 days"; null when not published. */
export function responseTimeLabel(hours: number | null) {
  if (!hours || hours < 1) return null;
  if (hours < 24) return `Within ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `Within ${days} ${days === 1 ? "day" : "days"}`;
}

/** Never optimistic: not accepting work always reads as such; unknown values show nothing. */
export function availabilityStatus(provider: Pick<PublicProvider, "availability" | "acceptingWork">) {
  if (!provider.acceptingWork || provider.availability === "UNAVAILABLE") return { label: "Not taking new work", tone: "muted" as const };
  if (provider.availability === "AVAILABLE") return { label: "Available for work", tone: "success" as const };
  if (provider.availability === "LIMITED") return { label: "Limited availability", tone: "warning" as const };
  return null;
}

/**
 * The provider's logo in a fixed square, or its initials when there is no logo or the image fails
 * to load (never a broken-image icon, never a layout shift).
 */
export function ProviderLogo({ name, url, size = "md" }: { name: string; url?: string | null; size?: "md" | "lg" }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = size === "lg" ? "h-20 w-20 text-2xl" : "h-14 w-14 text-lg";
  const showImage = Boolean(url) && failedUrl !== url;
  return (
    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-forest font-semibold text-gold-soft ${box}`} data-testid="provider-avatar">
      <span aria-hidden={showImage ? "true" : undefined}>{providerInitials(name)}</span>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`Logo for ${name}`}
          className="absolute inset-0 h-full w-full bg-white object-contain"
          loading="lazy"
          onError={() => setFailedUrl(url ?? null)}
          src={url!}
        />
      ) : null}
    </div>
  );
}



export function TrustSummary({
  provider,
}: {
  provider: Pick<
    PublicProvider,
    "verificationBadges" | "aggregateRating" | "ratingCount" | "completedJobs" | "availability" | "acceptingWork"
  >;
}) {
  const badges = verificationBadgeLabels(provider);
  const availability = availabilityStatus(provider);
  const rating = ratingSummary(provider);

  return (
    <div className="grid gap-3 rounded-2xl bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
      {badges.slice(0, 2).map((badge) => (
        <div className="text-sm font-medium" key={badge}>
          ✓ {badge}
        </div>
      ))}

      {availability && (
        <div className="text-sm font-medium">
          ✓ {availability.label}
        </div>
      )}

      {rating ? (
        <div className="text-sm font-medium">
          ★ {rating.score} ({rating.count})
        </div>
      ) : (
        <div className="text-sm font-medium text-muted">
          New provider
        </div>
      )}

      {provider.completedJobs > 0 && (
        <div className="text-sm font-medium">
          ✓ {completedJobsLabel(provider.completedJobs)}
        </div>
      )}
    </div>
  );
}

export function VerificationBadges({ provider }: { provider: Pick<PublicProvider, "verificationBadges"> }) {
  const labels = verificationBadgeLabels(provider);
  if (!labels.length) return null;
  return (
    <ul aria-label="Verified by NesAfric" className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li className="inline-flex items-center gap-1 rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-forest" key={label}>
          <svg aria-hidden="true" className="h-3.5 w-3.5 text-teal" fill="currentColor" viewBox="0 0 20 20"><path d="M10 1.5 3 4.5v5c0 4.2 3 7.6 7 8.9 4-1.3 7-4.7 7-8.9v-5l-7-3Zm-1 11.9-3.2-3.2 1.4-1.4L9 10.6l3.8-3.8 1.4 1.4L9 13.4Z" /></svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

export function AvailabilityBadge({ provider }: { provider: Pick<PublicProvider, "availability" | "acceptingWork"> }) {
  const status = availabilityStatus(provider);
  if (!status) return null;
  const dot = status.tone === "success" ? "bg-success" : status.tone === "warning" ? "bg-warning" : "bg-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${status.tone === "muted" ? "text-muted" : "text-ink"}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {status.label}
    </span>
  );
}

/** "★ 4.8 (84)" or "New on NesAfric" — the server's figures only. */
export function RatingLine({ provider }: { provider: Pick<PublicProvider, "aggregateRating" | "ratingCount"> }) {
  const rating = ratingSummary(provider);
  if (!rating) return <span className="text-sm text-muted">No ratings yet</span>;
  return (
    <span aria-label={`Rated ${rating.score} out of 5 from ${rating.count} verified ${rating.count === 1 ? "rating" : "ratings"}`} className="inline-flex items-center gap-1 text-sm">
      <span aria-hidden="true" className="text-gold">★</span>
      <span className="font-semibold text-ink">{rating.score}</span>
      <span className="text-muted">({rating.count.toLocaleString("en")})</span>
    </span>
  );
}
