import { useLocalSearchParams } from "expo-router";

import { UnitFormScreen } from "@/workspace/screens/property-screens";

export default function NewUnit() {
  const { organisationId, propertyId } = useLocalSearchParams<{ organisationId: string; propertyId: string }>();
  return <UnitFormScreen organisationId={organisationId} propertyId={propertyId} unitId={null} />;
}
