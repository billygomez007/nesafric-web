import type { Href } from "expo-router";

import type { Workspaces } from "@/api/account";
import { providerWorkspaces } from "@/api/account";
import { humanise } from "@/marketplace/format";

/**
 * The one place that decides which workspaces the app offers. The only input that can add a
 * workspace is the server's own `/api/workspaces` response for the signed-in user; the card a person
 * tapped (intent) and the remembered last workspace never add one. Every screen inside a workspace
 * is additionally re-checked by the server on each request.
 */
export type WorkspaceKind = "marketplace" | "property_management" | "professional" | "service_provider";

export type WorkspaceRef = { kind: WorkspaceKind; id: string | null };

export type AvailableWorkspace = WorkspaceRef & { name: string; subtitle: string; route: Href };

export type WorkspaceSession = { status: "restoring" | "signedIn" | "signedOut"; workspaces?: Workspaces };

export const MARKETPLACE: AvailableWorkspace = {
  kind: "marketplace",
  id: null,
  name: "Marketplace",
  subtitle: "Browse, save and enquire about properties",
  route: "/",
};

export const WORKSPACE_KIND_LABEL: Record<WorkspaceKind, string> = {
  marketplace: "Marketplace",
  property_management: "Property management",
  professional: "Real estate professional",
  service_provider: "Service provider",
};

export function resolveAvailableWorkspaces(session: WorkspaceSession): AvailableWorkspace[] {
  const { workspaces } = session;
  if (session.status !== "signedIn" || !workspaces) return [MARKETPLACE];
  return [
    MARKETPLACE,
    ...workspaces.propertyOsOrganisations
      .filter((organisation) => typeof organisation.id === "string" && organisation.id.trim().length > 0)
      .map((organisation) => ({
        kind: "property_management" as const,
        id: organisation.id,
        name: organisation.name,
        subtitle: WORKSPACE_KIND_LABEL.property_management,
        route: { pathname: "/workspace/[organisationId]", params: { organisationId: organisation.id } } as const,
      })),
    ...workspaces.marketplaceProfessionals
      .filter((professional) => typeof professional.id === "string" && professional.id.trim().length > 0)
      .map((professional) => ({
        kind: "professional" as const,
        id: professional.id,
        name: professional.displayName,
        subtitle: `${WORKSPACE_KIND_LABEL.professional} · ${humanise(professional.type)} · ${humanise(professional.myRole)}`,
        route: { pathname: "/agent/[professionalId]", params: { professionalId: professional.id } } as const,
      })),
    ...providerWorkspaces(workspaces)
      .filter((provider) => typeof provider.id === "string" && provider.id.trim().length > 0)
      .map((provider) => ({
        kind: "service_provider" as const,
        id: provider.id,
        name: provider.displayName,
        subtitle: `${WORKSPACE_KIND_LABEL.service_provider} · ${humanise(provider.verificationStatus)}`,
        route: { pathname: "/provider/[providerId]", params: { providerId: provider.id } } as const,
      })),
  ];
}

export const sameWorkspace = (a: WorkspaceRef | null | undefined, b: WorkspaceRef | null | undefined) => Boolean(a && b && a.kind === b.kind && a.id === b.id);

/**
 * Where "Continue" should point: the remembered workspace only while the server still lists it,
 * otherwise Marketplace. Navigation state only — it is never used to authorise anything.
 */
export function resolveInitialWorkspace(session: WorkspaceSession, lastActiveWorkspace: WorkspaceRef | null | undefined): AvailableWorkspace {
  return resolveAvailableWorkspaces(session).find((workspace) => sameWorkspace(workspace, lastActiveWorkspace)) ?? MARKETPLACE;
}

export const hasWorkspaceKind = (available: AvailableWorkspace[], kind: WorkspaceKind) => available.some((workspace) => workspace.kind === kind);

const INTENTS = ["property_management", "professional", "service_provider"] as const;
export type WorkspaceIntent = (typeof INTENTS)[number];

/** The card tapped on the signed-out Account screen. Only ever used to highlight, never to grant. */
export function parseIntent(value: unknown): WorkspaceIntent | null {
  return typeof value === "string" && (INTENTS as readonly string[]).includes(value) ? (value as WorkspaceIntent) : null;
}
