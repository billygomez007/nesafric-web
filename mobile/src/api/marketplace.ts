import type { ApiClient } from "./client";
import type { LeadCreated, LeadInput, ListingDetailResult, ListingSearchResult, ViewingInput } from "./types";
import type { SearchFilters } from "@/marketplace/filters";
import { filtersToQuery } from "@/marketplace/filters";

/** `GET /api/public/listings` — only PUBLISHED + VERIFIED, currently available listings. */
export const searchListings = (api: ApiClient, filters: SearchFilters, page = 1, pageSize = 20) =>
  api.request<ListingSearchResult>("/api/public/listings", { query: { ...filtersToQuery(filters), page, pageSize } });

export const getListing = (api: ApiClient, listingId: string) =>
  api.request<ListingDetailResult>(`/api/public/listings/${encodeURIComponent(listingId)}`);

/** `POST /api/public/listings/:id/leads` — guest enquiry (no account). */
export const createEnquiry = (api: ApiClient, listingId: string, input: LeadInput) =>
  api.request<LeadCreated>(`/api/public/listings/${encodeURIComponent(listingId)}/leads`, { method: "POST", body: input });

/** `POST /api/public/listings/:id/viewings` — needs the lead created by `createEnquiry`. */
export const requestViewing = (api: ApiClient, listingId: string, input: ViewingInput) =>
  api.request<unknown>(`/api/public/listings/${encodeURIComponent(listingId)}/viewings`, { method: "POST", body: input });
