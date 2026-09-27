import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ServiceCategory } from "@/api/types";
import { AppText } from "@/components/ui";
import { colors, fonts, radii } from "@/theme/tokens";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/** Icons are decoration only; any category the server adds later gets the fallback. */
const ICONS: Record<string, string> = {
  plumbing: "pipe-wrench",
  electrical: "flash",
  cleaning: "broom",
  deep_cleaning: "spray-bottle",
  hvac: "air-conditioner",
  carpentry: "hand-saw",
  painting: "format-paint",
  building_contractor: "wall",
  masonry: "wall",
  security: "shield-home",
  landscaping: "flower",
  pest_control: "bug",
  land_surveying: "map-marker-distance",
  property_valuation: "home-search",
  quantity_surveying: "calculator-variant",
  architecture: "floor-plan",
  facility_maintenance: "tools",
  roofing: "home-roof",
  solar: "solar-panel",
  locksmith: "key",
  appliance: "washing-machine",
  moving: "truck",
  photography: "camera",
};

export function categoryIcon(key: string): IconName {
  const name = ICONS[key];
  return name && name in MaterialCommunityIcons.glyphMap ? (name as IconName) : "toolbox-outline";
}

/** Two-column tiles; each opens the provider list for that service. */
export function CategoryTiles({ categories, onSelect }: { categories: ServiceCategory[]; onSelect: (category: ServiceCategory) => void }) {
  return (
    <View style={styles.grid}>
      {categories.map((category) => (
        <Pressable
          key={category.id}
          accessibilityRole="button"
          accessibilityLabel={category.name}
          testID={`service-category-${category.key}`}
          onPress={() => onSelect(category)}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
        >
          <View style={styles.icon}>
            <MaterialCommunityIcons name={categoryIcon(category.key)} size={20} color={colors.forestDeep} />
          </View>
          <AppText style={styles.label} numberOfLines={2}>{category.name}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    width: "48.8%",
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.shell,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  pressed: { backgroundColor: colors.surface },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17, color: colors.ink },
});
