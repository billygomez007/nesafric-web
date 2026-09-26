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

/** A service-provider profile the user owns (status fields only). */
export type ServiceProviderWorkspace = {
  id: string;
  displayName: string;
  type: string;
  slug: string | null;
  verificationStatus: string;
  availabilityStatus: string;
  suspended: boolean;
};

/**
 * `listUserWorkspaces`: only workspaces the user is an active member (or provider owner) of,
 * decided by the server. `serviceProviders` is missing on servers that predate it: read it through
 * `providerWorkspaces()`.
 */
export type Workspaces = {
  propertyOsOrganisations: OrganisationWorkspace[];
  marketplaceProfessionals: ProfessionalWorkspace[];
  serviceProviders?: ServiceProviderWorkspace[];
};

export const providerWorkspaces = (workspaces: Workspaces | undefined) => workspaces?.serviceProviders ?? [];

export type WorkspaceDashboard = {
  organisation: { id: string; name: string; logoUrl: string | null };
  properties: { id: string; name: string; referenceNumber: string | null; category: string; status: string }[];
  units: number;
  members: number;
};

export const createMobileSession = (api: ApiClient, input: { email: string; password: string }) =>
  api.request<MobileSessionResponse>("/api/auth/mobile/session", { method: "POST", body: input });

/**
 * Asks the server to revoke this token (the same route the web uses; 204 once no session row
 * remains for it). Takes the token explicitly because sign-out has already dropped it locally.
 */
export const revokeSession = (api: ApiClient, token: string) =>
  api.request<void>("/api/auth/logout", { method: "POST", auth: true, token, timeoutMs: 10_000 });

export const getProfile = (api: ApiClient, signal?: AbortSignal) => api.request<Profile>("/api/account/profile", { auth: true, signal });

export const getWorkspaces = (api: ApiClient, signal?: AbortSignal) => api.request<Workspaces>("/api/workspaces", { auth: true, signal });

export const getWorkspaceDashboard = (api: ApiClient, organisationId: string, signal?: AbortSignal) =>
  api.request<WorkspaceDashboard>("/api/dashboard", { auth: true, organisationId, signal });
