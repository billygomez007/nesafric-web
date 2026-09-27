import { DEFAULT_COUNTRY } from "./filters";
import type { ProviderAvailability, ProviderType } from "@/api/types";

/**
 * Filters the public provider discovery API supports (`publicMarketplaceDiscoverySchema`). Free
 * text (`q`) is searched by the server across names, descriptions, services and areas; nothing is
 * filtered on the device. There is no price filter on the server, so none is offered here.
 * Verification is not a filter either — the server only ever lists VERIFIED providers.
 */
export type ProviderFilters = {
  /** Free text, searched by the server. */
  q?: string;
  /** Service category key, e.g. "plumbing". */
  service?: string;
  providerType?: ProviderType;
  availability?: Exclude<ProviderAvailability, "UNAVAILABLE">;
  minimumRating?: string;
  region?: string;
  city?: string;
  district?: string;
  /** ISO country; the API requires it with any area filter. Defaults to Ghana (launch market). */
  country?: string;
};

export const PROVIDER_TYPE_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: "INDIVIDUAL", label: "Individuals" },
  { value: "COMPANY", label: "Companies" },
];

export const AVAILABILITY_OPTIONS: { value: NonNullable<ProviderFilters["availability"]>; label: string }[] = [
  { value: "AVAILABLE", label: "Available now" },
  { value: "LIMITED", label: "Limited availability" },
];

export const MINIMUM_RATING_OPTIONS = ["3", "4", "4.5"] as const;

const trimmed = (value: string | undefined) => value?.trim() || undefined;

/** Maps filters onto the API's query-string contract. */
export function providerFiltersToQuery(filters: ProviderFilters): Record<string, string | undefined> {
  const region = trimmed(filters.region);
  const city = trimmed(filters.city);
  const district = trimmed(filters.district);
  const hasArea = Boolean(region || city || district);
  return {
    q: trimmed(filters.q)?.replace(/\s+/g, " "),
    category: filters.service,
    providerType: filters.providerType,
    availability: filters.availability,
    minimumRating: filters.minimumRating,
    region,
    city,
    district,
    country: hasArea ? filters.country ?? DEFAULT_COUNTRY : undefined,
  };
}

/** Filters other than the service itself (the service is shown as its own chip). */
export function activeProviderFilterCount(filters: ProviderFilters) {
  const { q: _q, service: _service, country: _country, ...rest } = filters;
  return Object.values(rest).filter((value) => value !== undefined && value.trim() !== "").length;
}

/** Route params are strings; keep only the keys and values the API accepts. */
export function providerFiltersFromParams(params: Record<string, string | string[] | undefined>): ProviderFilters {
  const pick = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const service = pick("service");
  const providerType = pick("providerType");
  const availability = pick("availability");
  const minimumRating = pick("minimumRating");
  return {
    q: pick("q"),
    service: service && /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(service) ? service : undefined,
    providerType: providerType === "INDIVIDUAL" || providerType === "COMPANY" ? providerType : undefined,
    availability: availability === "AVAILABLE" || availability === "LIMITED" ? availability : undefined,
    minimumRating: (MINIMUM_RATING_OPTIONS as readonly string[]).includes(minimumRating ?? "") ? minimumRating : undefined,
    region: pick("region"),
    city: pick("city"),
    district: pick("district"),
    country: pick("country"),
  };
}
