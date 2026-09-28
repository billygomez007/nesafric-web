/**
 * Where the website sends someone right after signing in (password or Google), from the server's
 * own `listUserWorkspaces` answer. Order is unchanged for existing workspace kinds — property
 * management first, then real estate professional — with service-provider owners (who previously
 * fell through to onboarding) now sent to their provider workspace. Navigation only: every
 * workspace page re-checks membership on the server.
 */
export type SignInWorkspaces = {
  propertyOsOrganisations?: Array<{ id: string }>;
  marketplaceProfessionals?: Array<{ id: string }>;
  serviceProviders?: Array<{ id: string }>;
};

export const ACTIVE_ORGANISATION_KEY = "propertyos.activeOrganisationId";
export const ACTIVE_PROFESSIONAL_KEY = "nesafric.activeMarketplaceProfessionalId";

export type WorkspaceDestination = { path: string; remember?: { key: string; value: string } };

export function resolveSignInDestination(workspaces: SignInWorkspaces | undefined | null): WorkspaceDestination {
  if (!workspaces || !Array.isArray(workspaces.propertyOsOrganisations) || !Array.isArray(workspaces.marketplaceProfessionals)) {
    return { path: "/dashboard" };
  }
  const organisation = workspaces.propertyOsOrganisations[0];
  if (organisation) return { path: "/dashboard", remember: { key: ACTIVE_ORGANISATION_KEY, value: organisation.id } };
  const professional = workspaces.marketplaceProfessionals[0];
  if (professional) return { path: `/pro/${professional.id}`, remember: { key: ACTIVE_PROFESSIONAL_KEY, value: professional.id } };
  const provider = Array.isArray(workspaces.serviceProviders) ? workspaces.serviceProviders[0] : undefined;
  if (provider) return { path: `/providers/${provider.id}` };
  return { path: "/onboarding" };
}
