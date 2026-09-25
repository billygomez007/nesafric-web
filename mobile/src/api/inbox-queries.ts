import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { scopeKey, type InboxScope } from "@/workspace/scope";
import { ApiError, type ApiClient } from "./client";
import { getEnquiry, getViewing, listEnquiries, listViewings, type Enquiry, type EnquirySummary, type Page, type Viewing, type ViewingSummary } from "./inbox";

/**
 * Inbox data is keyed `["account", userId, "inbox", "org:<id>" | "pro:<id>", …]`: removed with the
 * rest of the account data on sign-out or session expiry, and per workspace when the person opens a
 * different one. It lives only in memory (React Query is not persisted) and is dropped soon after
 * its screens close.
 */
const INBOX_GC_TIME = 5 * 60_000;
export type InboxKind = "enquiries" | "viewings";

export const inboxKey = (userId: string | undefined, scope: InboxScope | null) => [...ACCOUNT_QUERY_KEY, userId, "inbox", scope ? scopeKey(scope) : ""] as const;

function removeInboxesExcept(queryClient: QueryClient, current: string) {
  queryClient.removeQueries({
    queryKey: ACCOUNT_QUERY_KEY,
    predicate: (query) => query.queryKey[2] === "inbox" && query.queryKey[3] !== current,
  });
}

/** Removes every cached inbox query that belongs to a different workspace than `scope`. */
export function clearOtherWorkspaces(queryClient: QueryClient, scope: InboxScope) {
  removeInboxesExcept(queryClient, scopeKey(scope));
}

/** Call on every screen scoped to a workspace: entering one drops the others' enquiry data. */
export function useActiveWorkspace(scope: InboxScope | null) {
  const queryClient = useQueryClient();
  const current = scope ? scopeKey(scope) : null;
  useEffect(() => {
    if (current) removeInboxesExcept(queryClient, current);
  }, [queryClient, current]);
}

/**
 * Whether the server lets this person read each section, asked of the server itself (one-row
 * request): 200 → allowed, with the real total; 403 → denied. No client-side role logic.
 */
export type SectionAccess = { state: "loading" } | { state: "allowed"; total: number } | { state: "denied" } | { state: "error"; error: unknown };

function useSectionProbe(kind: InboxKind, scope: InboxScope | null) {
  const { api, user, status } = useSession();
  const query = useQuery({
    queryKey: [...inboxKey(user?.id, scope), kind, "access"],
    queryFn: async ({ signal }) => {
      try {
        const page = await (kind === "enquiries" ? listEnquiries : listViewings)(api, scope!, 1, 1, signal);
        return { allowed: true as const, total: page.pagination.total };
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return { allowed: false as const, total: 0 };
        throw error;
      }
    },
    enabled: status === "signedIn" && Boolean(scope),
    gcTime: INBOX_GC_TIME,
  });
  const access: SectionAccess = query.data
    ? query.data.allowed
      ? { state: "allowed", total: query.data.total }
      : { state: "denied" }
    : query.error
      ? { state: "error", error: query.error }
      : { state: "loading" };
  return { access, refetch: query.refetch };
}

export function useInboxAccess(scope: InboxScope | null) {
  const enquiries = useSectionProbe("enquiries", scope);
  const viewings = useSectionProbe("viewings", scope);
  return {
    enquiries: enquiries.access,
    viewings: viewings.access,
    retry: () => Promise.all([enquiries.refetch(), viewings.refetch()]),
  };
}

function useInboxList<T>(kind: InboxKind, scope: InboxScope | null, fetchPage: (api: ApiClient, scope: InboxScope, page: number, pageSize: undefined, signal: AbortSignal) => Promise<Page<T>>) {
  const { api, user, status } = useSession();
  return useInfiniteQuery({
    queryKey: [...inboxKey(user?.id, scope), kind, "list"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchPage(api, scope!, pageParam, undefined, signal),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    enabled: status === "signedIn" && Boolean(scope),
    gcTime: INBOX_GC_TIME,
  });
}

export const useEnquiryList = (scope: InboxScope | null) => useInboxList<EnquirySummary>("enquiries", scope, listEnquiries);
export const useViewingList = (scope: InboxScope | null) => useInboxList<ViewingSummary>("viewings", scope, listViewings);

function findInList<T extends { id: string }>(queryClient: QueryClient, key: readonly unknown[], id: string) {
  const data = queryClient.getQueryData<InfiniteData<Page<T>>>(key);
  return data?.pages.flatMap((page) => page.items).find((item) => item.id === id);
}

function useItemQuery(kind: InboxKind, scope: InboxScope | null, id: string | undefined) {
  const { api, user, status } = useSession();
  const queryClient = useQueryClient();
  const base = inboxKey(user?.id, scope);
  return {
    api,
    queryKey: [...base, kind, "item", id],
    listKey: [...base, kind, "list"],
    queryClient,
    enabled: status === "signedIn" && Boolean(scope) && Boolean(id),
  };
}

/**
 * Details. While the detail request is in flight on a slow connection, the row already loaded in
 * the list is shown as a summary (`isPlaceholderData`); the full detail, re-checked by the
 * server, then replaces it.
 */
export function useEnquiry(scope: InboxScope | null, leadId: string | undefined) {
  const { api, queryKey, listKey, queryClient, enabled } = useItemQuery("enquiries", scope, leadId);
  return useQuery<Enquiry | EnquirySummary>({
    queryKey,
    queryFn: ({ signal }) => getEnquiry(api, scope!, leadId!, signal),
    placeholderData: () => (leadId ? findInList<EnquirySummary>(queryClient, listKey, leadId) : undefined),
    enabled,
    gcTime: INBOX_GC_TIME,
  });
}

export function useViewing(scope: InboxScope | null, viewingId: string | undefined) {
  const { api, queryKey, listKey, queryClient, enabled } = useItemQuery("viewings", scope, viewingId);
  return useQuery<Viewing | ViewingSummary>({
    queryKey,
    queryFn: ({ signal }) => getViewing(api, scope!, viewingId!, signal),
    placeholderData: () => (viewingId ? findInList<ViewingSummary>(queryClient, listKey, viewingId) : undefined),
    enabled,
    gcTime: INBOX_GC_TIME,
  });
}
