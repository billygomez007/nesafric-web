import { ScrollView, StyleSheet } from "react-native";

import { Chip } from "@/components/chip";
import { INTENTS, PROPERTY_TYPES, type SearchFilters } from "@/marketplace/filters";
import { openSearch } from "@/marketplace/navigation";
import { spacing } from "@/theme/tokens";

/** Rent · Buy · Land · Commercial · Houses · Apartments · Townhouses · Villas — each opens Search filtered. */
export const HOME_CATEGORIES: { label: string; filters: SearchFilters }[] = [
  ...INTENTS,
  ...PROPERTY_TYPES.filter((type) => ["HOUSE", "APARTMENT", "TOWNHOUSE", "VILLA"].includes(type.value)).map((type) => ({ label: type.label, filters: { category: type.value } })),
];

export function CategoryChips() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityLabel="Browse by category">
      {HOME_CATEGORIES.map((category) => (
        <Chip key={category.label} label={category.label} onPress={() => openSearch(category.filters)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ row: { paddingHorizontal: spacing.xl, gap: spacing.sm } });
