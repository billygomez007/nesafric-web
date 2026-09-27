import { useLocalSearchParams } from "expo-router";

import { PropertyFormScreen } from "@/workspace/screens/property-screens";

export default function NewProperty() {
  const { organisationId } = useLocalSearchParams<{ organisationId: string }>();
  return <PropertyFormScreen organisationId={organisationId} propertyId={null} />;
}
