import { useLocalSearchParams } from "expo-router";

import { TenantHomeScreen } from "@/tenant/screens/home";

export default function TenantHome() {
  const { tenancyId } = useLocalSearchParams<{ tenancyId: string }>();
  return <TenantHomeScreen tenancyId={tenancyId} />;
}
