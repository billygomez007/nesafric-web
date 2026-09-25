import type { ApiClient } from "./client";

/** Shapes returned by the web repo's account routes (see `src/app/api/{auth,account,workspaces,dashboard}`). */
export type MobileSessionResponse = {
  token: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: { id: string; email: string; displayName: string };
};

export type Profile = { id: string; displayName: string; email: string; emailVerified: boolean; createdAt: string };

export type OrganisationWorkspace = { id: string; name: string };

export type ProfessionalWorkspace = {
  id: string;
  displayName: string;
  type: string;
  status: string;
  verificationStatus: string;
  slug: string;
  myRole: string;
};

/** `listUserWorkspaces`: only workspaces the user is an active member of, decided by the server. */
export type Workspaces = { propertyOsOrganisations: OrganisationWorkspace[]; marketplaceProfessionals: ProfessionalWorkspace[] };

export type WorkspaceDashboard = {
  organisation: { id: string; name: string; logoUrl: string | null };
  properties: { id: string; name: string; referenceNumber: string | null; category: string; status: string }[];
  units: number;
  members: number;
};

export const createMobileSession = (api: ApiClient, input: { email: string; password: string }) =>
  api.request<MobileSessionResponse>("/api/auth/mobile/session", { method: "POST", body: input });

/** Revokes this device's session on the server (the same route the web uses). */
export const revokeSession = (api: ApiClient) => api.request<void>("/api/auth/logout", { method: "POST", auth: true });

export const getProfile = (api: ApiClient) => api.request<Profile>("/api/account/profile", { auth: true });

export const getWorkspaces = (api: ApiClient) => api.request<Workspaces>("/api/workspaces", { auth: true });

export const getWorkspaceDashboard = (api: ApiClient, organisationId: string) =>
  api.request<WorkspaceDashboard>("/api/dashboard", { auth: true, organisationId });
