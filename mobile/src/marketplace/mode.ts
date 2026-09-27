import { useSyncExternalStore } from "react";

/**
 * Which marketplace the person is browsing: Properties (the default every time the app starts) or
 * Service Providers. Shared by Home and Search so both tabs agree, and settable from navigation
 * helpers before they change route. Kept in memory only: it is a browsing choice for this
 * session, not a preference, so a fresh launch always opens Properties.
 */
export type MarketplaceMode = "properties" | "services";

let current: MarketplaceMode = "properties";
const listeners = new Set<() => void>();

export function setMarketplaceMode(mode: MarketplaceMode) {
  if (mode === current) return;
  current = mode;
  listeners.forEach((listener) => listener());
}

/** Test hook: every app start begins on Properties. */
export function resetMarketplaceMode() {
  setMarketplaceMode("properties");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => current;

export function useMarketplaceMode() {
  const mode = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { mode, setMode: setMarketplaceMode };
}

/** Reads `?marketplace=services|properties` from a route (deep links, Home → Search hand-off). */
export function modeFromParam(value: string | string[] | undefined): MarketplaceMode | undefined {
  return value === "services" || value === "properties" ? value : undefined;
}
