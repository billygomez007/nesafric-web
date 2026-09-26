import { colors, fonts } from "@/theme/tokens";

/** Header style for screens stacked on top of a workspace's tabs (inbox, enquiry, viewing). */
export const detailStackOptions = {
  headerShown: true,
  contentStyle: { backgroundColor: colors.background },
  headerTintColor: colors.ink,
  headerTitleStyle: { fontFamily: fonts.bold },
  headerStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
} as const;
