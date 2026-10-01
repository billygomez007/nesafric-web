import { useLocalSearchParams } from "expo-router";

import { TenantDetailScreen } from "@/workspace/screens/tenant-screens";

export default function Tenant() {
  const { organisationId, tenantId, placementError, accessNotice } = useLocalSearchParams<{
    organisationId: string;
    tenantId: string;
    placementError?: string;
    accessNotice?: string;
  }>();
  return (
    <TenantDetailScreen
      organisationId={organisationId}
      tenantId={tenantId}
      placementError={placementError}
      accessNotice={accessNotice}
    />
  );
}
