import type { ApiClient } from "./client";

/**
 * Read-only workspace inbox: marketplace enquiries (`/api/marketplace-leads`) and viewing requests
 * (`/api/viewing-requests`) for one organisation. The server checks membership and
 * `listing.lead.read` / `listing.viewing.read` on every call and returns only that organisation's
 * rows. These types are deliberately a subset of the responses: fields the app doesn't show (private
 * notes, internal activity metadata, submission hashes) are never typed or rendered.
 */
export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
export type Page<T> = { items: T[]; pagination: Pagination };

type ListingRef = { id: string; title: string; listingType: string; status: string };
type Assignee = { id: string; user: { id: string; displayName: string } | null } | null;
type StatusChange = { id: string; fromStatus: string | null; toStatus: string; createdAt: string };
export type PreferredTime = { id: string; startsAt: string; endsAt: string; timezone: string };

export type Enquiry = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  status: string;
  createdAt: string;
  lastActivityAt: string;
  listing: ListingRef;
  assignee: Assignee;
  history: StatusChange[];
  viewingRequests: { id: string; status: string; confirmedStartsAt: string | null; preferredTimes: PreferredTime[] }[];
  rentalApplications: { id: string; status: string }[];
};

export type Viewing = {
  id: string;
  status: string;
  requesterNote: string | null;
  outcome: string | null;
  confirmedStartsAt: string | null;
  confirmedEndsAt: string | null;
  createdAt: string;
  listing: ListingRef;
  lead: { id: string; name: string; email: string | null; phone: string | null; status: string };
  assignee: Assignee;
  preferredTimes: PreferredTime[];
  history: StatusChange[];
};

export const INBOX_PAGE_SIZE = 20;

const scoped = (organisationId: string, signal?: AbortSignal) => ({ auth: true, organisationId, signal }) as const;

export const listEnquiries = (api: ApiClient, organisationId: string, page: number, pageSize = INBOX_PAGE_SIZE, signal?: AbortSignal) =>
  api.request<Page<Enquiry>>("/api/marketplace-leads", { ...scoped(organisationId, signal), query: { page, pageSize } });

export const getEnquiry = (api: ApiClient, organisationId: string, leadId: string, signal?: AbortSignal) =>
  api.request<Enquiry>(`/api/marketplace-leads/${encodeURIComponent(leadId)}`, scoped(organisationId, signal));

export const listViewings = (api: ApiClient, organisationId: string, page: number, pageSize = INBOX_PAGE_SIZE, signal?: AbortSignal) =>
  api.request<Page<Viewing>>("/api/viewing-requests", { ...scoped(organisationId, signal), query: { page, pageSize } });

export const getViewing = (api: ApiClient, organisationId: string, viewingId: string, signal?: AbortSignal) =>
  api.request<Viewing>(`/api/viewing-requests/${encodeURIComponent(viewingId)}`, scoped(organisationId, signal));
