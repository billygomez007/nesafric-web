import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "@/theme/tokens";
import type { IconName } from "./list-row";
import { AppText } from "./ui";

/** Full-width entry card for the signed-out Account screen: icon, title, one line, chevron. */
export function GatewayCard({ icon, title, description, onPress, testID, highlighted = false }: { icon: IconName; title: string; description: string; onPress: () => void; testID?: string; highlighted?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={`${description} Opens sign in.`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, highlighted && styles.highlighted, pressed && styles.pressed]}
    >
      <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
        <Ionicons name={icon} size={24} color={colors.forest} />
      </View>
      <View style={styles.text}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption">{description}</AppText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: 72,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  highlighted: { borderColor: colors.brand, borderWidth: 2 },
  pressed: { backgroundColor: colors.surface },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
});
