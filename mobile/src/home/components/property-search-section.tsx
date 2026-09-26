import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import type { SearchFilters } from "@/marketplace/filters";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";
import { SectionHeading } from "./section-heading";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export const SEARCH_CARDS: { id: string; label: string; description: string; icon: IconName; filters: SearchFilters }[] = [
  { id: "rent", label: "For rent", description: "Find your next home", icon: "home", filters: { listingType: "RENT" } },
  { id: "sale", label: "For sale", description: "Own your future", icon: "cart", filters: { listingType: "SALE" } },
  { id: "land", label: "Land", description: "Invest in land", icon: "land-plots", filters: { category: "LAND" } },
  { id: "commercial", label: "Commercial", description: "Businesses & offices", icon: "office-building", filters: { category: "COMMERCIAL" } },
];

/** "Search properties": four entry points into the Search tab, in two columns. */
export function PropertySearchSection() {
  return (
    <View style={styles.section}>
      <SectionHeading title="Search properties" subtitle="Find the right property, in the right location." />
      <View style={styles.grid}>
        {SEARCH_CARDS.map((card) => <PropertyTypeCard key={card.id} {...card} />)}
      </View>
    </View>
  );
}

export function PropertyTypeCard({ label, description, icon, filters }: (typeof SEARCH_CARDS)[number]) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}`}
      onPress={() => openSearch(filters)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.icon}><MaterialCommunityIcons name={icon} size={21} color={colors.forestDeep} /></View>
      <View style={styles.copy}>
        <AppText style={styles.label} numberOfLines={1}>{label}</AppText>
        <AppText style={styles.description} numberOfLines={2}>{description}</AppText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: HOME_GUTTER, gap: 10 },
  // Two equal columns at any phone width: basis just under half, growing to fill the gap.
  card: {
    flexBasis: "46%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 52,
    paddingLeft: 7,
    paddingRight: 3,
    paddingVertical: 6,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  pressed: { backgroundColor: colors.surface },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  copy: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.forestDeep },
  description: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, color: colors.muted },
});
