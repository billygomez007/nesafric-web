import { useQuery } from "@tanstack/react-query";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { workspaceCacheKey, type GateKind } from "@/workspace/inbox-ui";
import type { ApiClient } from "./client";
import * as actions from "./workspace-actions";
import * as data from "./workspace-data";

/**
 * Workspace screen data, keyed `["account", userId, "ws", "org:…" | "pro:…" | "prv:…", section]`:
 * removed with all account data on sign-out, and per workspace when another one is opened.
 * `id` must come from the workspace gate (the server's own list); `null` never fetches.
 */
function useWorkspaceQuery<T>(kind: GateKind, id: string | null, section: string, fetch: (api: ApiClient, id: string, signal: AbortSignal) => Promise<T>) {
  const { api, user, status } = useSession();
  return useQuery({
    queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "ws", id ? workspaceCacheKey(kind, id) : "", section],
    queryFn: ({ signal }) => fetch(api, id!, signal),
    enabled: status === "signedIn" && Boolean(id),
  });
}

export const usePmProperties = (id: string | null) => useWorkspaceQuery("organisation", id, "properties", data.listPmProperties);
export const usePmTenants = (id: string | null) => useWorkspaceQuery("organisation", id, "tenants", data.listPmTenants);
export const usePmMaintenance = (id: string | null) => useWorkspaceQuery("organisation", id, "maintenance", data.listPmMaintenance);
export const usePmMaintenanceSummary = (id: string | null) => useWorkspaceQuery("organisation", id, "maintenance-summary", data.getPmMaintenanceSummary);

export const useProDashboard = (id: string | null) => useWorkspaceQuery("professional", id, "dashboard", data.getProDashboard);
export const useProListings = (id: string | null) => useWorkspaceQuery("professional", id, "listings", data.listProListings);
export const useProListing = (id: string | null, listingId: string | null) =>
  useWorkspaceQuery("professional", listingId ? id : null, `listing:${listingId}`, (api, professionalId, signal) => actions.getProListing(api, professionalId, listingId!, signal));

export const usePmProperty = (id: string | null, propertyId: string | null) =>
  useWorkspaceQuery("organisation", propertyId ? id : null, `property:${propertyId}`, (api, organisationId, signal) => actions.getPmProperty(api, organisationId, propertyId!, signal));
export const usePmTenant = (id: string | null, tenantId: string | null) =>
  useWorkspaceQuery("organisation", tenantId ? id : null, `tenant:${tenantId}`, (api, organisationId, signal) => actions.getPmTenant(api, organisationId, tenantId!, signal));

export const useProviderProfile = (id: string | null) => useWorkspaceQuery("provider", id, "profile", data.getProviderProfile);
export const useProviderMetrics = (id: string | null) => useWorkspaceQuery("provider", id, "metrics", data.getProviderMetrics);
export const useProviderJobs = (id: string | null) => useWorkspaceQuery("provider", id, "jobs", data.listProviderJobs);
