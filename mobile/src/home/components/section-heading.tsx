import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { colors, fonts, spacing } from "@/theme/tokens";

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <AppText accessibilityRole="header" style={styles.title}>{title}</AppText>
      {subtitle ? <AppText variant="caption" style={styles.subtitle}>{subtitle}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.forest },
  subtitle: { fontSize: 14, lineHeight: 20 },
});
