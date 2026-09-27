import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { ApiError } from "./client";
import { getTenantMaintenanceRequest, listTenancies, listTenantMaintenance, type Tenancy, type TenantMaintenanceRequest } from "./tenant";

/**
 * Tenant data is keyed `["account", userId, "tenancy", "ten:<tenantOrganisationId>", …]`: removed with
 * the rest of the account data on sign-out or session expiry, and per home when the person opens a
 * different one. In memory only (React Query is not persisted), dropped soon after its screens close.
 */
const TENANCY_GC_TIME = 5 * 60_000;

export const tenancyScopeKey = (tenantOrganisationId: string) => `ten:${tenantOrganisationId}`;
export const tenancyKey = (userId: string | undefined, tenantOrganisationId: string | undefined) =>
  [...ACCOUNT_QUERY_KEY, userId, "tenancy", tenantOrganisationId ? tenancyScopeKey(tenantOrganisationId) : ""] as const;

function removeTenanciesExcept(queryClient: QueryClient, current: string) {
  queryClient.removeQueries({
    queryKey: ACCOUNT_QUERY_KEY,
    predicate: (query) => query.queryKey[2] === "tenancy" && query.queryKey[3] !== current,
  });
}

/**
 * The server's list of the signed-in user's own tenancies. A server without this route yet (404)
 * simply has no homes to show.
 */
export function useTenancies() {
  const { api, user, status } = useSession();
  return useQuery({
    queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "tenancies"],
    queryFn: async ({ signal }) => {
      try {
        return (await listTenancies(api, signal)).tenancies;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return [];
        throw error;
      }
    },
    enabled: status === "signedIn",
  });
}

/**
 * One tenancy, looked up in the server's list. The organisation id sent as `x-organisation-id` always
 * comes from that list, never from the route. Opening a home drops every other home's cached data.
 */
export function useTenancy(tenantOrganisationId: string | undefined) {
  const tenancies = useTenancies();
  const queryClient = useQueryClient();
  const tenancy: Tenancy | undefined = tenancies.data?.find((item) => item.tenantOrganisationId === tenantOrganisationId);
  useEffect(() => {
    if (tenantOrganisationId) removeTenanciesExcept(queryClient, tenancyScopeKey(tenantOrganisationId));
  }, [queryClient, tenantOrganisationId]);
  return { tenancies, tenancy };
}

export function useTenantMaintenance(tenancy: Tenancy | undefined) {
  const { api, user, status } = useSession();
  return useQuery({
    queryKey: [...tenancyKey(user?.id, tenancy?.tenantOrganisationId), "maintenance", "list"],
    queryFn: ({ signal }) => listTenantMaintenance(api, tenancy!, signal),
    enabled: status === "signedIn" && Boolean(tenancy),
    gcTime: TENANCY_GC_TIME,
  });
}

/** Detail; the row already loaded in the list is shown while the server re-checks it. */
export function useTenantMaintenanceRequest(tenancy: Tenancy | undefined, requestId: string | undefined) {
  const { api, user, status } = useSession();
  const queryClient = useQueryClient();
  const base = tenancyKey(user?.id, tenancy?.tenantOrganisationId);
  return useQuery<TenantMaintenanceRequest>({
    queryKey: [...base, "maintenance", "item", requestId],
    queryFn: ({ signal }) => getTenantMaintenanceRequest(api, tenancy!, requestId!, signal),
    placeholderData: () => queryClient.getQueryData<TenantMaintenanceRequest[]>([...base, "maintenance", "list"])?.find((item) => item.id === requestId),
    enabled: status === "signedIn" && Boolean(tenancy) && Boolean(requestId),
    gcTime: TENANCY_GC_TIME,
  });
}

/** After a successful report: show it in the list straight away, then refresh from the server. */
export function useRecordNewRequest() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return (tenancy: Tenancy, created: TenantMaintenanceRequest) => {
    const listKey = [...tenancyKey(user?.id, tenancy.tenantOrganisationId), "maintenance", "list"];
    queryClient.setQueryData<TenantMaintenanceRequest[]>(listKey, (current) => [created, ...(current ?? []).filter((item) => item.id !== created.id)]);
    void queryClient.invalidateQueries({ queryKey: listKey });
  };
}
