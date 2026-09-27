import { router } from "expo-router";

import type { SearchFilters } from "./filters";

/** Opens the Search tab with the given filters as route params (empty values dropped). */
export function openSearch(filters: SearchFilters) {
  const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""));
  router.navigate({ pathname: "/search", params });
}

/**
 * Opens the Search tab with its filter sheet already open. The value is a fresh token so that
 * opening it again from Home remounts Search and shows the sheet again.
 */
export function openAdvancedSearch() {
  router.navigate({ pathname: "/search", params: { advanced: String(Date.now()) } });
}
