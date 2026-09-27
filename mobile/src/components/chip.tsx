import { Pressable, StyleSheet } from "react-native";

import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { AppText } from "./ui";

export function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && !selected && styles.pressed]}
    >
      <AppText style={[styles.label, selected && styles.labelSelected]}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    justifyContent: "center",
  },
  selected: { backgroundColor: colors.forest, borderColor: colors.forest },
  pressed: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.ink },
  labelSelected: { color: colors.white },
});
