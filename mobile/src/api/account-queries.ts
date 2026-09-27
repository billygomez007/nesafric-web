import { useQuery } from "@tanstack/react-query";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { getProfile, getWorkspaceDashboard, getWorkspaces } from "./account";

/**
 * All account data is keyed under ["account", userId, …] so sign-out can cancel and drop it in one
 * call; the query signal aborts requests still in flight.
 */
export function useProfile() {
  const { api, user, status } = useSession();
  return useQuery({ queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "profile"], queryFn: ({ signal }) => getProfile(api, signal), enabled: status === "signedIn" });
}

export function useWorkspaces() {
  const { api, user, status } = useSession();
  return useQuery({ queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "workspaces"], queryFn: ({ signal }) => getWorkspaces(api, signal), enabled: status === "signedIn" });
}

/** Only called for an organisation taken from the server's own workspace list. */
export function useWorkspaceDashboard(organisationId: string | null) {
  const { api, user, status } = useSession();
  return useQuery({
    queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "dashboard", organisationId],
    queryFn: ({ signal }) => getWorkspaceDashboard(api, organisationId!, signal),
    enabled: status === "signedIn" && Boolean(organisationId),
  });
}
