import type { InboxScope } from "@/workspace/scope";
import type { ApiClient } from "./client";

/**
 * Read-only workspace inbox: marketplace enquiries and viewing requests for one workspace.
 *
 * Every call asks for the server's `view=inbox` response shape, which leaves out private notes,
 * internal status-change notes and internal ids at the server (see
 * `src/modules/listings/lead-responses.ts` in the web repo). Access is decided by the server on
 * every call: organisation membership + `listing.lead.read` / `listing.viewing.read`, or active
 * membership of the marketplace professional.
 */
export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
export type Page<T> = { items: T[]; pagination: Pagination };

type ListingRef = { id: string; title: string; listingType: string; status: string };
type Assignee = { id: string; user: { displayName: string } } | null;
type StatusChange = { id: string; fromStatus: string | null; toStatus: string; createdAt: string };
export type PreferredTime = { id: string; startsAt: string; endsAt: string; timezone: string };

/** `view=inbox` list row. */
export type EnquirySummary = { id: string; name: string; status: string; createdAt: string; lastActivityAt: string; listing: ListingRef };

/** `view=inbox` detail. */
export type Enquiry = EnquirySummary & {
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  assignee: Assignee;
  history: StatusChange[];
  viewingRequests: { id: string; status: string; confirmedStartsAt: string | null; preferredTimes: PreferredTime[] }[];
  rentalApplications: { id: string; status: string }[];
};

export type ViewingSummary = {
  id: string;
  status: string;
  confirmedStartsAt: string | null;
  confirmedEndsAt: string | null;
  createdAt: string;
  listing: ListingRef;
  lead: { id: string; name: string; status: string };
  assignee: Assignee;
  preferredTimes: PreferredTime[];
};

export type Viewing = ViewingSummary & {
  requesterNote: string | null;
  outcome: string | null;
  lead: { id: string; name: string; email: string | null; phone: string | null; status: string };
  history: StatusChange[];
};

export const INBOX_PAGE_SIZE = 20;

function target(scope: InboxScope, kind: "leads" | "viewings", id?: string) {
  const suffix = id ? `/${encodeURIComponent(id)}` : "";
  if (scope.kind === "professional") {
    return { path: `/api/marketplace-professionals/${encodeURIComponent(scope.id)}/${kind}${suffix}`, organisationId: undefined };
  }
  return { path: `${kind === "leads" ? "/api/marketplace-leads" : "/api/viewing-requests"}${suffix}`, organisationId: scope.id };
}

function list<T>(api: ApiClient, scope: InboxScope, kind: "leads" | "viewings", page: number, pageSize: number, signal?: AbortSignal) {
  const { path, organisationId } = target(scope, kind);
  return api.request<Page<T>>(path, { auth: true, organisationId, signal, query: { page, pageSize, view: "inbox" } });
}

function detail<T>(api: ApiClient, scope: InboxScope, kind: "leads" | "viewings", id: string, signal?: AbortSignal) {
  const { path, organisationId } = target(scope, kind, id);
  return api.request<T>(path, { auth: true, organisationId, signal, query: { view: "inbox" } });
}

export const listEnquiries = (api: ApiClient, scope: InboxScope, page: number, pageSize = INBOX_PAGE_SIZE, signal?: AbortSignal) =>
  list<EnquirySummary>(api, scope, "leads", page, pageSize, signal);
export const getEnquiry = (api: ApiClient, scope: InboxScope, leadId: string, signal?: AbortSignal) => detail<Enquiry>(api, scope, "leads", leadId, signal);
export const listViewings = (api: ApiClient, scope: InboxScope, page: number, pageSize = INBOX_PAGE_SIZE, signal?: AbortSignal) =>
  list<ViewingSummary>(api, scope, "viewings", page, pageSize, signal);
export const getViewing = (api: ApiClient, scope: InboxScope, viewingId: string, signal?: AbortSignal) => detail<Viewing>(api, scope, "viewings", viewingId, signal);
