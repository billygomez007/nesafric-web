import { Pressable, StyleSheet } from "react-native";

import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { AppText } from "./ui";

export type ChipTone = "default" | "rent" | "sale" | "land" | "commercial" | "residential";

const toneColors: Record<ChipTone, { foreground: string; background: string; border: string }> = {
  default: {
    foreground: colors.ink,
    background: colors.elevated,
    border: colors.hairline,
  },
  rent: {
    foreground: colors.marketRent,
    background: colors.marketRentTint,
    border: colors.marketRent,
  },
  sale: {
    foreground: colors.marketSale,
    background: colors.marketSaleTint,
    border: colors.marketSale,
  },
  land: {
    foreground: colors.marketLand,
    background: colors.marketLandTint,
    border: colors.marketLand,
  },
  commercial: {
    foreground: colors.marketCommercial,
    background: colors.marketCommercialTint,
    border: colors.marketCommercial,
  },
  residential: {
    foreground: colors.marketVerified,
    background: colors.marketVerifiedTint,
    border: colors.marketVerified,
  },
};

export function Chip({
  label,
  selected = false,
  tone = "default",
  onPress,
}: {
  label: string;
  selected?: boolean;
  tone?: ChipTone;
  onPress: () => void;
}) {
  const palette = toneColors[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        tone !== "default" && {
          backgroundColor: palette.background,
          borderColor: palette.border,
        },
        selected && styles.selected,
        pressed && !selected && styles.pressed,
      ]}
    >
      <AppText
        style={[
          styles.label,
          tone !== "default" && { color: palette.foreground },
          selected && styles.labelSelected,
        ]}
      >
        {label}
      </AppText>
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
