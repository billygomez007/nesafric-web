import { router } from "expo-router";

import { setMarketplaceMode } from "@/marketplace/mode";
import type { ProviderFilters } from "@/marketplace/provider-filters";

/** Opens the Search tab on the Service Providers marketplace with the given filters. */
export function openProviderSearch(filters: ProviderFilters = {}) {
  const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""));
  setMarketplaceMode("services");
  router.navigate({ pathname: "/search", params: { ...params, marketplace: "services" } });
}

export function openProvider(providerId: string) {
  router.push({ pathname: "/marketplace/services/[providerId]", params: { providerId } });
}

/** Opens Request Service; `quote` pre-selects asking for a formal quotation. */
export function openRequestService(providerId: string, categoryId?: string, quote = false) {
  const params: Record<string, string> = { providerId };
  if (categoryId) params.categoryId = categoryId;
  if (quote) params.quote = "1";
  router.push({ pathname: "/marketplace/services/[providerId]/request", params: params as { providerId: string } });
}
