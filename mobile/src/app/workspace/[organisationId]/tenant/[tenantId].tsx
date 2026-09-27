import { useLocalSearchParams } from "expo-router";

import { TenantDetailScreen } from "@/workspace/screens/tenant-screens";

export default function Tenant() {
  const { organisationId, tenantId, placementError } = useLocalSearchParams<{ organisationId: string; tenantId: string; placementError?: string }>();
  return <TenantDetailScreen organisationId={organisationId} tenantId={tenantId} placementError={placementError} />;
}
