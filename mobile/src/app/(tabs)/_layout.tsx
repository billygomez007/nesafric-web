import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/tabs";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { colors, fonts } from "@/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(active: IconName, inactive: IconName) {
  function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? active : inactive} color={color} size={size} />;
  }
  return TabIcon;
}

/**
 * Signed-out marketplace navigation. The brief's Map tab is intentionally absent until a real
 * interactive map ships (no area list masquerading as a map).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: { backgroundColor: colors.elevated, borderTopColor: colors.hairline },
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home", "home-outline") }} />
      <Tabs.Screen name="search" options={{ title: "Search", tabBarIcon: tabIcon("search", "search-outline") }} />
      <Tabs.Screen name="saved" options={{ title: "Saved", tabBarIcon: tabIcon("heart", "heart-outline") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: tabIcon("person-circle", "person-circle-outline") }} />
    </Tabs>
  );
}
