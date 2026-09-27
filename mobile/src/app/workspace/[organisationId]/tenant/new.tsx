import { useLocalSearchParams } from "expo-router";

import { NewTenantScreen } from "@/workspace/screens/tenant-screens";

export default function NewTenant() {
  const { organisationId } = useLocalSearchParams<{ organisationId: string }>();
  return <NewTenantScreen organisationId={organisationId} />;
}
