import type { Href } from "expo-router";

import { MARKETPLACE, sameWorkspace, type AvailableWorkspace, type WorkspaceIntent, type WorkspaceRef } from "./resolve";

/**
 * Where the app goes after sign-in or at launch. Pure functions over the list produced by
 * `resolveAvailableWorkspaces` (the server's `/api/workspaces` answer), so neither the tapped card
 * (intent) nor the remembered last workspace can ever open a workspace the server didn't list.
 */
export type SignInIntent = WorkspaceIntent | "customer";

export type Destination =
  | { type: "marketplace" }
  | { type: "workspace"; workspace: AvailableWorkspace }
  /** The account has no workspace of the chosen kind: explain it and offer set-up. */
  | { type: "setup"; kind: WorkspaceIntent };

export function resolvePostSignInDestination(intent: SignInIntent, available: AvailableWorkspace[], lastActive: WorkspaceRef | null | undefined): Destination {
  // Marketplace-first: a property seeker stays in the marketplace (where they signed in from),
  // whatever else they belong to; their workspaces stay one tap away under Account.
  if (intent === "customer") return { type: "marketplace" };
  const matching = available.filter((workspace) => workspace.kind === intent);
  if (!matching.length) return { type: "setup", kind: intent };
  // Several of that kind: prefer the one used last, otherwise the first the server lists.
  return { type: "workspace", workspace: matching.find((workspace) => sameWorkspace(workspace, lastActive)) ?? matching[0] };
}

/** Launch: the remembered workspace only while the server still lists it; otherwise Marketplace. */
export function resolveLaunchDestination(available: AvailableWorkspace[], lastActive: WorkspaceRef | null | undefined): Destination {
  const workspace = available.find((candidate) => sameWorkspace(candidate, lastActive));
  return workspace && workspace.kind !== "marketplace" ? { type: "workspace", workspace } : { type: "marketplace" };
}

export function destinationHref(destination: Destination): Href {
  if (destination.type === "workspace") return destination.workspace.route;
  if (destination.type === "setup") return { pathname: "/setup/[kind]", params: { kind: destination.kind } };
  return MARKETPLACE.route;
}

/** Website paths for setting up each kind (the website asks the person to sign in there). */
export const SETUP_PATH: Record<WorkspaceIntent, string> = {
  property_management: "/onboarding?start=manage",
  professional: "/pro/new",
  service_provider: "/onboarding?start=services",
};

/** New accounts: register on the website, then land on the matching set-up step. */
export function registerPath(intent: SignInIntent) {
  return intent === "customer" ? "/register" : `/register?returnTo=${encodeURIComponent(SETUP_PATH[intent])}`;
}
