import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Workspaces } from "@/api/account";
import { resolveAvailableWorkspaces, sameWorkspace, type WorkspaceKind, type WorkspaceRef } from "@/workspace/resolve";

/**
 * Remembers the last workspace a user opened, per user id: `{ kind, id }`, not a credential, so it
 * lives in AsyncStorage. It is navigation state only: it is used only if the server's current
 * workspace list still contains it, and it is removed on sign-out so a shared phone keeps nothing.
 */
const PREFIX = "nesafric.last-workspace.";
const keyFor = (userId: string) => `${PREFIX}v2:${userId}`;
const legacyKeyFor = (userId: string) => `${PREFIX}v1:${userId}`;
const KINDS: WorkspaceKind[] = ["property_management", "professional", "service_provider"];

export function isListedOrganisation(workspaces: Workspaces | undefined, organisationId: string | null | undefined) {
  return Boolean(organisationId && workspaces?.propertyOsOrganisations.some((organisation) => organisation.id === organisationId));
}

function parseRef(raw: string | null): WorkspaceRef | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkspaceRef>;
    return typeof value?.id === "string" && KINDS.includes(value.kind as WorkspaceKind) ? { kind: value.kind as WorkspaceKind, id: value.id } : null;
  } catch {
    return null;
  }
}

/** The remembered workspace if the server still lists it; anything else is removed. */
export async function loadLastWorkspace(userId: string, workspaces: Workspaces): Promise<WorkspaceRef | null> {
  try {
    const [[, stored], [, legacy]] = await AsyncStorage.multiGet([keyFor(userId), legacyKeyFor(userId)]);
    // v1 held a bare organisation id.
    const ref = parseRef(stored) ?? (legacy ? { kind: "property_management" as const, id: legacy } : null);
    if (legacy) await AsyncStorage.removeItem(legacyKeyFor(userId));
    const listed = ref && resolveAvailableWorkspaces({ status: "signedIn", workspaces }).some((workspace) => sameWorkspace(workspace, ref));
    if (listed) {
      if (!parseRef(stored)) await AsyncStorage.setItem(keyFor(userId), JSON.stringify(ref));
      return ref;
    }
    if (stored) await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Treat unreadable storage as "no preference".
  }
  return null;
}

export async function rememberWorkspace(userId: string, ref: WorkspaceRef) {
  if (ref.kind === "marketplace" || !ref.id) {
    await AsyncStorage.removeItem(keyFor(userId)).catch(() => undefined);
    return;
  }
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ kind: ref.kind, id: ref.id })).catch(() => undefined);
}

/** Removes every remembered workspace on this device (all users, all versions). */
export async function clearLastWorkspaces() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Nothing more to do: the value grants nothing and is re-validated before use.
  }
}
