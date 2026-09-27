import { Stack } from "expo-router/stack";

import { detailStackOptions } from "@/workspace/stack-options";

/** Service provider workspace. */
export default function ProviderLayout() {
  return (
    <Stack screenOptions={detailStackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
