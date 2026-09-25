import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { ApiError } from "./client";
import { getEnquiry, getViewing, listEnquiries, listViewings, type Enquiry, type Page, type Viewing } from "./inbox";

/**
 * Inbox data is keyed `["account", userId, "inbox", organisationId, …]`: removed with the rest of the
 * account data on sign-out or session expiry, and per organisation when the person switches
 * workspace. It lives only in memory (React Query is not persisted) and is dropped soon after its
 * screens close.
 */
const INBOX_GC_TIME = 5 * 60_000;
export type InboxKind = "enquiries" | "viewings";

export const inboxKey = (userId: string | undefined, organisationId: string) => [...ACCOUNT_QUERY_KEY, userId, "inbox", organisationId] as const;

/** Removes every cached inbox query that belongs to a different organisation than `organisationId`. */
export function clearOtherWorkspaces(queryClient: QueryClient, organisationId: string) {
  queryClient.removeQueries({
    queryKey: ACCOUNT_QUERY_KEY,
    predicate: (query) => query.queryKey[2] === "inbox" && query.queryKey[3] !== organisationId,
  });
}

/** Call on every screen scoped to a workspace: entering one drops the others' enquiry data. */
export function useActiveWorkspace(organisationId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (organisationId) clearOtherWorkspaces(queryClient, organisationId);
  }, [queryClient, organisationId]);
}

/**
 * Whether the server lets this person read each section, asked of the server itself (one-row
 * request): 200 → allowed, with the real total; 403 → denied. No client-side role logic.
 */
export type SectionAccess = { state: "loading" } | { state: "allowed"; total: number } | { state: "denied" } | { state: "error"; error: unknown };

function useSectionProbe(kind: InboxKind, organisationId: string | null) {
  const { api, user, status } = useSession();
  const query = useQuery({
    queryKey: [...inboxKey(user?.id, organisationId ?? ""), kind, "access"],
    queryFn: async ({ signal }) => {
      try {
        const page = await (kind === "enquiries" ? listEnquiries : listViewings)(api, organisationId!, 1, 1, signal);
        return { allowed: true as const, total: page.pagination.total };
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return { allowed: false as const, total: 0 };
        throw error;
      }
    },
    enabled: status === "signedIn" && Boolean(organisationId),
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

export function useInboxAccess(organisationId: string | null) {
  const enquiries = useSectionProbe("enquiries", organisationId);
  const viewings = useSectionProbe("viewings", organisationId);
  return {
    enquiries: enquiries.access,
    viewings: viewings.access,
    retry: () => Promise.all([enquiries.refetch(), viewings.refetch()]),
  };
}

function useInboxList<T>(kind: InboxKind, organisationId: string | null, fetchPage: typeof listEnquiries | typeof listViewings) {
  const { api, user, status } = useSession();
  return useInfiniteQuery({
    queryKey: [...inboxKey(user?.id, organisationId ?? ""), kind, "list"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchPage(api, organisationId!, pageParam, undefined, signal) as Promise<Page<T>>,
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    enabled: status === "signedIn" && Boolean(organisationId),
    gcTime: INBOX_GC_TIME,
  });
}

export const useEnquiryList = (organisationId: string | null) => useInboxList<Enquiry>("enquiries", organisationId, listEnquiries);
export const useViewingList = (organisationId: string | null) => useInboxList<Viewing>("viewings", organisationId, listViewings);

function findInList<T extends { id: string }>(queryClient: QueryClient, key: readonly unknown[], id: string) {
  const data = queryClient.getQueryData<InfiniteData<Page<T>>>(key);
  return data?.pages.flatMap((page) => page.items).find((item) => item.id === id);
}

function useItemQuery(kind: InboxKind, organisationId: string | null, id: string | undefined) {
  const { api, user, status } = useSession();
  const queryClient = useQueryClient();
  const base = inboxKey(user?.id, organisationId ?? "");
  return {
    api,
    queryKey: [...base, kind, "item", id],
    listKey: [...base, kind, "list"],
    queryClient,
    enabled: status === "signedIn" && Boolean(organisationId) && Boolean(id),
  };
}

// Both detail hooks show the row already loaded in the list straight away on slow connections
// (placeholder only); the detail request, re-checked by the server, then replaces it.
export function useEnquiry(organisationId: string | null, leadId: string | undefined) {
  const { api, queryKey, listKey, queryClient, enabled } = useItemQuery("enquiries", organisationId, leadId);
  return useQuery<Enquiry>({
    queryKey,
    queryFn: ({ signal }) => getEnquiry(api, organisationId!, leadId!, signal),
    placeholderData: () => (leadId ? findInList<Enquiry>(queryClient, listKey, leadId) : undefined),
    enabled,
    gcTime: INBOX_GC_TIME,
  });
}

export function useViewing(organisationId: string | null, viewingId: string | undefined) {
  const { api, queryKey, listKey, queryClient, enabled } = useItemQuery("viewings", organisationId, viewingId);
  return useQuery<Viewing>({
    queryKey,
    queryFn: ({ signal }) => getViewing(api, organisationId!, viewingId!, signal),
    placeholderData: () => (viewingId ? findInList<Viewing>(queryClient, listKey, viewingId) : undefined),
    enabled,
    gcTime: INBOX_GC_TIME,
  });
}
