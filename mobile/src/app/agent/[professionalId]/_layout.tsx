import { Stack } from "expo-router/stack";

import { detailStackOptions } from "@/workspace/stack-options";

/** Real estate professional workspace: bottom tabs, with the inbox, its details and the listing editor stacked on top. */
export default function ProfessionalLayout() {
  return (
    <Stack screenOptions={detailStackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="inbox" options={{ title: "Enquiries & viewings", headerBackTitle: "Workspace" }} />
      <Stack.Screen name="enquiry/[leadId]" options={{ title: "Enquiry", headerBackTitle: "Inbox" }} />
      <Stack.Screen name="viewing/[viewingId]" options={{ title: "Viewing request", headerBackTitle: "Inbox" }} />
      <Stack.Screen name="listing/new" options={{ title: "Add listing", headerBackTitle: "Listings" }} />
      <Stack.Screen name="listing/[listingId]" options={{ title: "Edit listing", headerBackTitle: "Listings" }} />
    </Stack>
  );
}
