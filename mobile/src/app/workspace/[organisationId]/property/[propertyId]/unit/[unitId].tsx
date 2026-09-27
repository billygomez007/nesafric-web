import { useLocalSearchParams } from "expo-router";

import { UnitFormScreen } from "@/workspace/screens/property-screens";

export default function EditUnit() {
  const { organisationId, propertyId, unitId } = useLocalSearchParams<{ organisationId: string; propertyId: string; unitId: string }>();
  return <UnitFormScreen organisationId={organisationId} propertyId={propertyId} unitId={unitId ?? null} />;
}
