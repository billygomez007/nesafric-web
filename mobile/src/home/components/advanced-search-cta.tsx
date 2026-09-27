import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { openAdvancedSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";

/** Opens the Search tab's existing filter sheet (price, bedrooms, bathrooms, location…). */
export function AdvancedSearchCTA() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Advanced search"
      onPress={openAdvancedSearch}
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
    >
      <View style={styles.icon}><MaterialCommunityIcons name="magnify" size={22} color={colors.white} /></View>
      <View style={styles.copy}>
        <AppText style={styles.title}>Advanced Search</AppText>
        <AppText style={styles.body} numberOfLines={2}>Filter by price, location, property type and more</AppText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: HOME_GUTTER,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.shell,
    backgroundColor: colors.forestDeep,
  },
  pressed: { backgroundColor: colors.forest },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.white },
  body: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 15, color: "rgba(255,255,255,0.82)" },
});
