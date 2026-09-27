import { useQuery } from "@tanstack/react-query";

import { getFeaturedCampaigns, getVerifiedCompanies } from "./home";
import { useApi } from "./provider";

export function useFeaturedCampaigns() {
  const { api } = useApi();
  // No retries: a failed ad request hides the carousel at once (pull to refresh asks again)
  // instead of holding a skeleton above the listings on a weak network.
  return useQuery({ queryKey: ["home", "campaigns"], queryFn: () => getFeaturedCampaigns(api), retry: false });
}

export function useVerifiedCompanies() {
  const { api } = useApi();
  return useQuery({ queryKey: ["home", "companies"], queryFn: () => getVerifiedCompanies(api) });
}
