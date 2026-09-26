import { useLocalSearchParams } from "expo-router";

import { TenantRequestScreen } from "@/tenant/screens/request";

export default function TenantRequest() {
  const { tenancyId, requestId } = useLocalSearchParams<{ tenancyId: string; requestId: string }>();
  return <TenantRequestScreen tenancyId={tenancyId} requestId={requestId} />;
}
