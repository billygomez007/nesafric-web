import { useSyncExternalStore } from "react";

import type { EntryIntent } from "./resolve";

/**
 * Which entry card (Tenant, or a "Manage on NesAfric" card) a signed-out person tapped. Memory only, never stored, never
 * sent to the server, and never a source of access: after sign-in it only decides what the Account
 * screen highlights (the matching workspace if the server lists one, otherwise the matching offer).
 */
let intent: EntryIntent | null = null;
const listeners = new Set<() => void>();

export function setWorkspaceIntent(next: EntryIntent | null) {
  intent = next;
  listeners.forEach((listener) => listener());
}

export function useWorkspaceIntent() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => intent,
  );
}
