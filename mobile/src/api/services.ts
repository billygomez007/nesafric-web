import type { ApiClient } from "./client";
import type { ProviderDetailResult, ProviderSearchResult, SavedProvidersResult, ServiceCategory, ServiceEnquiryCreated, ServiceEnquiryInput } from "./types";
import { providerFiltersToQuery, type ProviderFilters } from "@/marketplace/provider-filters";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /api/public/marketplace/categories` — active, publicly visible categories in admin order. */
export const listServiceCategories = (api: ApiClient, signal?: AbortSignal) =>
  api.request<ServiceCategory[]>("/api/public/marketplace/categories", { signal });

/**
 * `GET /api/public/marketplace/providers` — listed, VERIFIED, non-suspended providers in the
 * server's ranking order (`marketplace-v1`). Filtering and ranking happen on the server only.
 */
export const searchProviders = (api: ApiClient, filters: ProviderFilters, page = 1, pageSize = 20, signal?: AbortSignal) =>
  api.request<ProviderSearchResult>("/api/public/marketplace/providers", { query: { ...providerFiltersToQuery(filters), page, pageSize }, signal });

/**
 * One public provider, by id (`/providers/:id`) or by the web's profile slug (`/services/:slug`),
 * so a shared `nesafric.com/marketplace/services/<slug>` link resolves too.
 */
export const getMarketplaceProvider = (api: ApiClient, idOrSlug: string, signal?: AbortSignal) =>
  api.request<ProviderDetailResult>(
    UUID.test(idOrSlug)
      ? `/api/public/marketplace/providers/${encodeURIComponent(idOrSlug)}`
      : `/api/public/marketplace/services/${encodeURIComponent(idOrSlug)}`,
    { signal },
  );

/**
 * `POST /api/marketplace/enquiries` — any signed-in NesAfric customer may send a direct
 * provider enquiry. A property-management organisation is optional and is included only when
 * the requester deliberately scopes the job to one of their workspaces.
 */
export const createServiceEnquiry = (api: ApiClient, organisationId: string | undefined, input: ServiceEnquiryInput) =>
  api.request<ServiceEnquiryCreated>("/api/marketplace/enquiries", {
    method: "POST",
    auth: true,
    ...(organisationId ? { organisationId } : {}),
    body: input,
  });

/** `POST /api/marketplace/enquiries/:id/quote-request` — needs the enquiry to be scoped to a maintenance request. */
export const requestServiceQuote = (api: ApiClient, organisationId: string, enquiryId: string, scope: string) =>
  api.request<unknown>(`/api/marketplace/enquiries/${encodeURIComponent(enquiryId)}/quote-request`, {
    method: "POST",
    auth: true,
    organisationId,
    body: { scope },
  });

/** Saved providers belong to the signed-in account (server-side), not to this device. */
export const listSavedProviders = (api: ApiClient, signal?: AbortSignal) =>
  api.request<SavedProvidersResult>("/api/marketplace/saved-providers", { auth: true, signal });

/** Idempotent on the server; 404 when the provider isn't publicly listed. */
export const saveProvider = (api: ApiClient, providerId: string) =>
  api.request<{ providerId: string; saved: true; savedAt: string }>(`/api/marketplace/saved-providers/${encodeURIComponent(providerId)}`, { method: "POST", auth: true });

/** Idempotent on the server. */
export const unsaveProvider = (api: ApiClient, providerId: string) =>
  api.request<{ providerId: string; saved: false }>(`/api/marketplace/saved-providers/${encodeURIComponent(providerId)}`, { method: "DELETE", auth: true });
