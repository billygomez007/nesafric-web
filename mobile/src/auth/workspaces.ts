import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Workspaces } from "@/api/account";

/**
 * Remembers the last workspace a user opened, per user id. Not a credential (just an id), so it
 * lives in AsyncStorage. It is only ever used if the server's current workspace list still
 * contains it — membership is decided by the server, never by this value.
 */
const keyFor = (userId: string) => `nesafric.last-workspace.v1:${userId}`;

export function isListedOrganisation(workspaces: Workspaces | undefined, organisationId: string | null | undefined) {
  return Boolean(organisationId && workspaces?.propertyOsOrganisations.some((organisation) => organisation.id === organisationId));
}

export async function loadLastWorkspace(userId: string, workspaces: Workspaces): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(keyFor(userId));
    if (isListedOrganisation(workspaces, stored)) return stored;
    if (stored) await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Treat unreadable storage as "no preference".
  }
  return null;
}

export async function rememberWorkspace(userId: string, organisationId: string) {
  await AsyncStorage.setItem(keyFor(userId), organisationId).catch(() => undefined);
}
