import { useQuery } from "@tanstack/react-query";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { getProfile, getWorkspaceDashboard, getWorkspaces } from "./account";

/** All account data is keyed under ["account", userId, …] so sign-out can drop it in one call. */
export function useProfile() {
  const { api, user, status } = useSession();
  return useQuery({ queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "profile"], queryFn: () => getProfile(api), enabled: status === "signedIn" });
}

export function useWorkspaces() {
  const { api, user, status } = useSession();
  return useQuery({ queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "workspaces"], queryFn: () => getWorkspaces(api), enabled: status === "signedIn" });
}

/** Only called for an organisation taken from the server's own workspace list. */
export function useWorkspaceDashboard(organisationId: string | null) {
  const { api, user, status } = useSession();
  return useQuery({
    queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "dashboard", organisationId],
    queryFn: () => getWorkspaceDashboard(api, organisationId!),
    enabled: status === "signedIn" && Boolean(organisationId),
  });
}
