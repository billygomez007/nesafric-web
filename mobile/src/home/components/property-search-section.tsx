import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { useListingCollection } from "@/api/queries";
import { AppText } from "@/components/ui";
import type { SearchFilters } from "@/marketplace/filters";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { SectionHeading } from "./section-heading";

type IconName = keyof typeof Ionicons.glyphMap;

export const SEARCH_CARDS: { id: string; label: string; description: string; icon: IconName; filters: SearchFilters }[] = [
  { id: "houses", label: "Houses", description: "Homes and villas", icon: "home-outline", filters: { category: "HOUSE" } },
  { id: "apartments", label: "Apartments", description: "Flats and studios", icon: "business-outline", filters: { category: "APARTMENT" } },
  { id: "land", label: "Land", description: "Plots and acreage", icon: "map-outline", filters: { category: "LAND" } },
  { id: "commercial", label: "Commercial", description: "Offices and shops", icon: "storefront-outline", filters: { category: "COMMERCIAL" } },
];

/** "Search properties": four entry points into the Search tab, each with its live listing count. */
export function PropertySearchSection() {
  return (
    <View style={styles.section}>
      <SectionHeading title="Search properties" subtitle="Browse verified listings by type" />
      <View style={styles.grid}>
        {SEARCH_CARDS.map((card) => <PropertyTypeCard key={card.id} {...card} />)}
      </View>
    </View>
  );
}

export function PropertyTypeCard({ label, description, icon, filters, id }: (typeof SEARCH_CARDS)[number]) {
  // A one-item page is enough: the API returns the total, so the count is real and cheap.
  const count = useListingCollection(`count:${id}`, filters, 1);
  const total = count.data?.pagination.total;
  const countText = total === undefined ? " " : total === 0 ? "No listings yet" : total === 1 ? "1 property" : `${total.toLocaleString()} properties`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}. ${countText.trim()}`}
      onPress={() => openSearch(filters)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.icon}><Ionicons name={icon} size={22} color={colors.forest} /></View>
      <View style={styles.cardCopy}>
        <AppText style={styles.label} numberOfLines={1}>{label}</AppText>
        <AppText variant="caption" numberOfLines={1}>{description}</AppText>
      </View>
      <View style={styles.footer}>
        <AppText style={styles.count} numberOfLines={1}>{countText}</AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.forest} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.xl, gap: spacing.md },
  // Two equal columns at any width: (100% - one gap) / 2.
  card: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 148,
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    shadowColor: "#102d2a",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  pressed: { backgroundColor: colors.surface },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  cardCopy: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.ink },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  count: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.forest },
});
