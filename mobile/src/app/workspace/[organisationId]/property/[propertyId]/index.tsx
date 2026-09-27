import { useLocalSearchParams } from "expo-router";

import { PropertyDetailScreen } from "@/workspace/screens/property-screens";

export default function Property() {
  const { organisationId, propertyId } = useLocalSearchParams<{ organisationId: string; propertyId: string }>();
  return <PropertyDetailScreen organisationId={organisationId} propertyId={propertyId} />;
}
