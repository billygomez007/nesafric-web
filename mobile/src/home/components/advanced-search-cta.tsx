import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { openAdvancedSearch } from "@/marketplace/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

/** Opens the Search tab's existing filter sheet (price, bedrooms, bathrooms, location…). */
export function AdvancedSearchCTA() {
  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <AppText style={styles.title}>Know exactly what you want?</AppText>
        <AppText style={styles.body}>Filter by price, bedrooms, bathrooms and location.</AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Advanced search"
        onPress={openAdvancedSearch}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons name="options-outline" size={18} color={colors.forest} />
        <AppText style={styles.buttonText}>Advanced search</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.xl, padding: spacing.xl, gap: spacing.lg, borderRadius: radii.shell, backgroundColor: colors.forest },
  copy: { gap: spacing.xs },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.white },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: "rgba(255,255,255,0.82)" },
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.cream },
  buttonText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.forest },
});
