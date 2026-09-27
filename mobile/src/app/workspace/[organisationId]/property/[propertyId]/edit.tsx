import { useLocalSearchParams } from "expo-router";

import { PropertyFormScreen } from "@/workspace/screens/property-screens";

export default function EditProperty() {
  const { organisationId, propertyId } = useLocalSearchParams<{ organisationId: string; propertyId: string }>();
  return <PropertyFormScreen organisationId={organisationId} propertyId={propertyId ?? null} />;
}
