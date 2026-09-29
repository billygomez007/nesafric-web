import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { INTENTS, PROPERTY_TYPES, type SearchFilters } from "@/marketplace/filters";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const ICONS: Record<string, IconName> = {
  Rent: "home", Buy: "cart", Land: "land-plots", Commercial: "office-building",
  Hotels: "bed", "Short stays": "bag-suitcase", Warehouses: "warehouse",
  Houses: "home-variant", Apartments: "domain", Townhouses: "home-group", Villas: "home-modern",
};

/**
 * Rent · Buy · Land · Commercial · Hotels · Short stays · Warehouses / Houses · Apartments ·
 * Townhouses · Villas — each opens Search filtered.
 */
export const HOME_CATEGORIES: { label: string; filters: SearchFilters }[] = [
  ...INTENTS,
  ...PROPERTY_TYPES.filter((type) => ["HOUSE", "APARTMENT", "TOWNHOUSE", "VILLA"].includes(type.value)).map((type) => ({ label: type.label, filters: { category: type.value } })),
];

/** Two rows of icon chips (intents, then property types) that scroll sideways together. */
export function CategoryChips() {
  const rows = [HOME_CATEGORIES.slice(0, INTENTS.length), HOME_CATEGORIES.slice(INTENTS.length)];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroller} accessibilityLabel="Browse by category">
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <View key={index} style={styles.row}>
            {row.map((category) => (
              <Pressable
                key={category.label}
                accessibilityRole="button"
                accessibilityLabel={category.label}
                onPress={() => openSearch(category.filters)}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name={ICONS[category.label] ?? "home"} size={17} color={colors.forestDeep} />
                <AppText style={styles.label}>{category.label}</AppText>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { paddingHorizontal: HOME_GUTTER },
  rows: { gap: 9 },
  row: { flexDirection: "row", gap: 7 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  pressed: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, letterSpacing: -0.1, color: colors.forestDeep },
});
