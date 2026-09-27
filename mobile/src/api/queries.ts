import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type { SearchFilters } from "@/marketplace/filters";
import { getListing, searchListings } from "./marketplace";
import { useApi } from "./provider";

const PAGE_SIZE = 20;

export function useListingCollection(key: string, filters: SearchFilters, size = 8) {
  const { api } = useApi();
  return useQuery({ queryKey: ["collection", key, filters, size], queryFn: () => searchListings(api, filters, 1, size) });
}

export function useListingSearch(filters: SearchFilters) {
  const { api } = useApi();
  return useInfiniteQuery({
    queryKey: ["search", filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => searchListings(api, filters, pageParam, PAGE_SIZE),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
  });
}

export function useListing(listingId: string | undefined) {
  const { api } = useApi();
  return useQuery({ queryKey: ["listing", listingId], queryFn: () => getListing(api, listingId!), enabled: Boolean(listingId) });
}
