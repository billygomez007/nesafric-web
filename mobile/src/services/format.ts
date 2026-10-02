import type { ProviderServiceArea, PublicProvider, ServiceCategory } from "@/api/types";
import { formatMoney } from "@/marketplace/format";

/**
 * Display rules for provider trust information. Platform-derived figures (rating, rating count,
 * completed jobs, verification) come straight from the server; nothing here computes or rounds
 * them into something better. Values the provider enters themselves (starting rate, response
 * time) are labelled as the provider's own so they never read as NesAfric's record.
 */

export function providerTypeLabel(type: string) {
  return type === "COMPANY" ? "Company" : type === "INDIVIDUAL" ? "Individual" : null;
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function formatArea(area: ProviderServiceArea) {
  if (area.label) return area.label;
  const parts = [area.district, area.city, area.region].filter(Boolean);
  return parts.length ? parts.join(", ") : area.countryCode === "GH" ? "Ghana" : area.countryCode;
}

/** "East Legon, Accra" or "East Legon, Accra +2 areas"; null when no public area. */
export function formatPrimaryArea(provider: Pick<PublicProvider, "serviceAreas">) {
  const [first, ...rest] = provider.serviceAreas;
  if (!first) return null;
  return rest.length ? `${formatArea(first)} +${rest.length} ${rest.length === 1 ? "area" : "areas"}` : formatArea(first);
}

/** Honest availability: a provider not accepting work is never shown as available. */
export function availabilityLabel(provider: Pick<PublicProvider, "availability" | "acceptingWork">) {
  if (!provider.acceptingWork || provider.availability === "UNAVAILABLE") return { label: "Not taking new work", tone: "muted" as const };
  if (provider.availability === "AVAILABLE") return { label: "Available for work", tone: "success" as const };
  if (provider.availability === "LIMITED") return { label: "Limited availability", tone: "warning" as const };
  return null;
}

/** Null when there are no ratings — never a zero or placeholder star value. */
export function formatRating(provider: Pick<PublicProvider, "aggregateRating" | "ratingCount">) {
  if (provider.aggregateRating === null || provider.ratingCount < 1) return null;
  return { score: provider.aggregateRating.toFixed(1), count: `${provider.ratingCount.toLocaleString()} ${provider.ratingCount === 1 ? "rating" : "ratings"}` };
}

export function formatCompletedJobs(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "job" : "jobs"} completed`;
}

/**
 * "96% completion rate" — only for a rate the server computed; null (render nothing) when the
 * server has too little history or doesn't send one. Never derived from other fields here.
 */
export function formatCompletionRate(provider: Pick<PublicProvider, "completionRate">) {
  const rate = provider.completionRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  return `${Math.round(rate * 100)}% completion rate`;
}

/** Provider-stated rate: "From GH₵250"; null when not published. */
export function formatStartingRate(provider: Pick<PublicProvider, "pricing">) {
  const { startingRateMinor, currencyCode } = provider.pricing;
  return startingRateMinor && currencyCode ? `From ${formatMoney(startingRateMinor, currencyCode)}` : null;
}

/** Provider-stated response time: "Within 4 hours" / "Within 2 days"; null when not published. */
export function formatResponseTime(hours: number | null) {
  if (!hours || hours < 1) return null;
  if (hours < 24) return `Within ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `Within ${days} ${days === 1 ? "day" : "days"}`;
}

/** Only the levels the server reports as reviewer-approved, in a fixed order. */
export function verificationBadges(provider: Pick<PublicProvider, "verificationBadges">) {
  const badges = provider.verificationBadges;
  if (!badges) return [];
  return [
    badges.identity ? "Verified Identity" : null,
    badges.business ? "Verified Business" : null,
    badges.skill ? "Verified Professional" : null,
  ].filter((label): label is string => label !== null);
}

/**
 * The core services NesAfric leads with, by server category key. Used only to order the list the
 * server returns: a category the server doesn't list never appears, and categories an admin adds
 * later still appear (after these, in the server's own order).
 */
const LEAD_SERVICE_KEYS = [
  "plumbing",
  "electrical",
  "cleaning",
  "hvac",
  "carpentry",
  "painting",
  "building_contractor",
  "security",
  "landscaping",
  "pest_control",
  "land_surveying",
  "property_valuation",
  "quantity_surveying",
  "architecture",
  "facility_maintenance",
];

export function orderCategories(categories: ServiceCategory[]) {
  const rank = (key: string) => {
    const index = LEAD_SERVICE_KEYS.indexOf(key);
    return index === -1 ? LEAD_SERVICE_KEYS.length : index;
  };

  return categories
    .map((category, index) => ({ category, index }))
    .sort((a, b) => {
      const aTopLevel = a.category.parentId === null;
      const bTopLevel = b.category.parentId === null;

      if (aTopLevel && bTopLevel) {
        return a.category.sortOrder - b.category.sortOrder || a.index - b.index;
      }

      return (
        rank(a.category.key) - rank(b.category.key) ||
        a.category.sortOrder - b.category.sortOrder ||
        a.index - b.index
      );
    })
    .map(({ category }) => category);
}
