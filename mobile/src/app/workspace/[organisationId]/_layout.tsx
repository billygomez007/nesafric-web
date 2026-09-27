import { Stack } from "expo-router/stack";

import { detailStackOptions } from "@/workspace/stack-options";

/** Property management workspace: bottom tabs, with the inbox, property, unit and tenant screens stacked on top. */
export default function PropertyManagementLayout() {
  return (
    <Stack screenOptions={detailStackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="inbox" options={{ title: "Enquiries & viewings", headerBackTitle: "Workspace" }} />
      <Stack.Screen name="enquiry/[leadId]" options={{ title: "Enquiry", headerBackTitle: "Inbox" }} />
      <Stack.Screen name="viewing/[viewingId]" options={{ title: "Viewing request", headerBackTitle: "Inbox" }} />
      <Stack.Screen name="property/new" options={{ title: "Add property", headerBackTitle: "Properties" }} />
      <Stack.Screen name="property/[propertyId]/index" options={{ title: "Property", headerBackTitle: "Properties" }} />
      <Stack.Screen name="property/[propertyId]/edit" options={{ title: "Edit property", headerBackTitle: "Property" }} />
      <Stack.Screen name="property/[propertyId]/unit/new" options={{ title: "Add unit", headerBackTitle: "Property" }} />
      <Stack.Screen name="property/[propertyId]/unit/[unitId]" options={{ title: "Edit unit", headerBackTitle: "Property" }} />
      <Stack.Screen name="tenant/new" options={{ title: "Add tenant", headerBackTitle: "Tenants" }} />
      <Stack.Screen name="tenant/[tenantId]" options={{ title: "Tenant", headerBackTitle: "Tenants" }} />
    </Stack>
  );
}
