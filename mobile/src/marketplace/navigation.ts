import { router } from "expo-router";

import type { SearchFilters } from "./filters";

/** Opens the Search tab with the given filters as route params (empty values dropped). */
export function openSearch(filters: SearchFilters) {
  const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""));
  router.navigate({ pathname: "/search", params });
}
