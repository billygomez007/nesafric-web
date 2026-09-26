import { Stack } from "expo-router/stack";

import { detailStackOptions } from "@/workspace/stack-options";

/** Property management workspace: bottom tabs, with the inbox and its details stacked on top. */
export default function PropertyManagementLayout() {
  return (
    <Stack screenOptions={detailStackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="inbox" options={{ title: "Enquiries & viewings", headerBackTitle: "Workspace" }} />
      <Stack.Screen name="enquiry/[leadId]" options={{ title: "Enquiry", headerBackTitle: "Inbox" }} />
      <Stack.Screen name="viewing/[viewingId]" options={{ title: "Viewing request", headerBackTitle: "Inbox" }} />
    </Stack>
  );
}
