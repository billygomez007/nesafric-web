import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import type { ProviderFilters } from "@/marketplace/provider-filters";
import { useApi } from "./provider";
import { getMarketplaceProvider, listSavedProviders, listServiceCategories, saveProvider, searchProviders, unsaveProvider } from "./services";
import type { PublicProvider, SavedProvidersResult } from "./types";

const PAGE_SIZE = 20;

/** Public Service Provider Marketplace data lives under `["services", …]` (never account data). */
export function useServiceCategories() {
  const { api } = useApi();
  return useQuery({ queryKey: ["services", "categories"], queryFn: ({ signal }) => listServiceCategories(api, signal), staleTime: 5 * 60_000 });
}

/** First page only, for Home's "Available providers" section. */
export function useProviderCollection(filters: ProviderFilters, size = 6) {
  const { api } = useApi();
  return useQuery({ queryKey: ["services", "collection", filters, size], queryFn: ({ signal }) => searchProviders(api, filters, 1, size, signal) });
}

export function useProviderSearch(filters: ProviderFilters) {
  const { api } = useApi();
  return useInfiniteQuery({
    queryKey: ["services", "search", filters],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => searchProviders(api, filters, pageParam, PAGE_SIZE, signal),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
  });
}

export function useMarketplaceProvider(idOrSlug: string | undefined) {
  const { api } = useApi();
  return useQuery({
    queryKey: ["services", "provider", idOrSlug],
    queryFn: ({ signal }) => getMarketplaceProvider(api, idOrSlug!, signal),
    enabled: Boolean(idOrSlug),
  });
}

/** The signed-in user's saved providers (server-side). Kept under the account key, so sign-out drops it. */
export function useSavedProviders() {
  const { api, user, status } = useSession();
  return useQuery({
    queryKey: savedProvidersKey(user?.id),
    queryFn: ({ signal }) => listSavedProviders(api, signal),
    enabled: status === "signedIn",
  });
}

const savedProvidersKey = (userId: string | undefined) => [...ACCOUNT_QUERY_KEY, userId, "saved-providers"] as const;

/**
 * Save / unsave. Deliberately not optimistic: the saved state changes only once the server has
 * accepted it, so a refused request can never read as saved (or removed).
 */
export function useToggleSavedProvider() {
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, save }: { provider: PublicProvider | { id: string }; save: boolean }): Promise<{ savedAt: string | null }> =>
      save ? saveProvider(api, provider.id) : unsaveProvider(api, provider.id).then(() => ({ savedAt: null })),
    onSuccess: (result, { provider, save }) => {
      queryClient.setQueryData<SavedProvidersResult>(savedProvidersKey(user?.id), (current) => {
        const others = (current?.items ?? []).filter((item) => item.providerId !== provider.id);
        if (!save) return { items: others };
        const savedAt = result.savedAt ?? new Date().toISOString();
        return "displayName" in provider
          ? { items: [{ providerId: provider.id, savedAt, available: true, provider }, ...others] }
          : current;
      });
      void queryClient.invalidateQueries({ queryKey: savedProvidersKey(user?.id) });
    },
  });
}
