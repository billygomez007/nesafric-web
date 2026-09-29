import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { colors, fonts } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";

export function SectionHeading({ title, subtitle, size = "large", action }: { title: string; subtitle?: string; size?: "large" | "small"; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <AppText accessibilityRole="header" style={size === "large" ? styles.large : styles.small} numberOfLines={1}>{title}</AppText>
        {action ? (
          <Pressable accessibilityRole="link" accessibilityLabel={action.label} hitSlop={8} onPress={action.onPress} style={styles.action}>
            <AppText style={styles.actionText}>{action.label}</AppText>
            <MaterialCommunityIcons name="arrow-right" size={16} color={colors.action} />
          </Pressable>
        ) : null}
      </View>
      {subtitle ? <AppText style={styles.subtitle}>{subtitle}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: HOME_GUTTER, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  large: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 19, lineHeight: 25, letterSpacing: -0.3, color: colors.forestDeep },
  small: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.forestDeep },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted },
  // "See all" is a discovery action: orange text and arrow, 32pt tall plus hitSlop, 48pt to touch.
  action: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingLeft: 8 },
  actionText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17, color: colors.action },
});
