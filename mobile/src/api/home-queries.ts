import { useQuery } from "@tanstack/react-query";

import { getFeaturedCampaigns, getVerifiedCompanies } from "./home";
import { useApi } from "./provider";

export function useFeaturedCampaigns(
  placement: "MARKETPLACE_PRIMARY" | "MARKETPLACE_INLINE" | "SERVICE_MARKETPLACE_PRIMARY",
) {
  const { api } = useApi();
  // Keep each marketplace's campaigns in its own cache entry so switching
  // between Properties and Service Providers never reuses the other carousel.
  return useQuery({
    queryKey: ["home", "campaigns", placement],
    queryFn: () => getFeaturedCampaigns(api, placement),
    retry: false,
  });
}

export function useVerifiedCompanies() {
  const { api } = useApi();
  return useQuery({ queryKey: ["home", "companies"], queryFn: () => getVerifiedCompanies(api) });
}
