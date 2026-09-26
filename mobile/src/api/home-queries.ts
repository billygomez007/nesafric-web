import { useQuery } from "@tanstack/react-query";

import { getFeaturedCampaigns, getVerifiedCompanies } from "./home";
import { useApi } from "./provider";

export function useFeaturedCampaigns() {
  const { api } = useApi();
  return useQuery({ queryKey: ["home", "campaigns"], queryFn: () => getFeaturedCampaigns(api) });
}

export function useVerifiedCompanies() {
  const { api } = useApi();
  return useQuery({ queryKey: ["home", "companies"], queryFn: () => getVerifiedCompanies(api) });
}
