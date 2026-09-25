import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useListingSearch } from "@/api/queries";
import { Chip } from "@/components/chip";
import { ListingCard } from "@/components/listing-card";
import { QueryState } from "@/components/query-state";
import { AppText, Button, StateMessage, TextField } from "@/components/ui";
import { activeFilterCount, filtersFromParams, PROPERTY_TYPES, validateFilters, type SearchFilters } from "@/marketplace/filters";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

export default function SearchScreen() {
  const params = useLocalSearchParams();
  // Home chips and "See all" navigate here with new params: remount with those as the start state.
  const paramsKey = JSON.stringify(params);
  return <SearchView key={paramsKey} initial={filtersFromParams(params)} />;
}

function SearchView({ initial }: { initial: SearchFilters }) {
  const [filters, setFilters] = useState<SearchFilters>(initial);
  const [q, setQ] = useState(initial.q ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const search = useListingSearch(filters);
  const items = search.data?.pages.flatMap((page) => page.items) ?? [];
  const total = search.data?.pages[0]?.pagination.total;
  const count = activeFilterCount(filters);

  function submitQuery() {
    const next = { ...filters, q: q.trim() || undefined };
    if (validateFilters(next).q) return;
    setFilters(next);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={submitQuery}
            placeholder="Area, city or property"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            accessibilityLabel="Search by area, city or property"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={count ? `Filters, ${count} active` : "Filters"}
          onPress={() => setFiltersOpen(true)}
          style={[styles.filterButton, count > 0 && styles.filterButtonActive]}
        >
          <Ionicons name="options-outline" size={20} color={count ? colors.white : colors.ink} />
          {count ? <AppText style={styles.filterCount}>{count}</AppText> : null}
        </Pressable>
      </View>
      {total !== undefined ? (
        <AppText variant="caption" style={styles.total}>
          {total === 1 ? "1 verified property" : `${total.toLocaleString()} verified properties`}
        </AppText>
      ) : null}

      {!search.data ? (
        <QueryState isPending={search.isPending} error={search.error} onRetry={() => search.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(listing) => listing.id}
          renderItem={({ item }) => <ListingCard listing={item} />}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.5}
          onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && search.fetchNextPage()}
          ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : null}
          ListEmptyComponent={
            <StateMessage
              title="No matching properties"
              message="Try a different area or fewer filters."
              actionLabel={count ? "Clear filters" : undefined}
              onAction={count ? () => setFilters({ q: filters.q }) : undefined}
            />
          }
          refreshControl={<RefreshControl refreshing={search.isRefetching && !search.isFetchingNextPage} onRefresh={() => search.refetch()} tintColor={colors.brand} />}
          initialNumToRender={4}
          windowSize={7}
        />
      )}

      {/* Mounted only while open, so the draft always starts from the applied filters. */}
      {filtersOpen ? (
        <FilterSheet
        filters={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters({ ...next, q: filters.q });
          setFiltersOpen(false);
        }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const BEDROOM_OPTIONS = ["1", "2", "3", "4", "5"];
const BATHROOM_OPTIONS = ["1", "2", "3", "4"];

function FilterSheet({ filters, onClose, onApply }: { filters: SearchFilters; onClose: () => void; onApply: (filters: SearchFilters) => void }) {
  const [draft, setDraft] = useState(filters);
  const errors = validateFilters(draft);
  const set = (patch: Partial<SearchFilters>) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => set({ [key]: draft[key] === value ? undefined : value } as Partial<SearchFilters>);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <AppText variant="heading">Filters</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Section title="Looking to">
            <Chip label="Rent" selected={draft.listingType === "RENT"} onPress={() => toggle("listingType", "RENT")} />
            <Chip label="Buy" selected={draft.listingType === "SALE"} onPress={() => toggle("listingType", "SALE")} />
          </Section>
          <Section title="Property type">
            {PROPERTY_TYPES.map((type) => (
              <Chip key={type.value} label={type.label} selected={draft.category === type.value} onPress={() => toggle("category", type.value)} />
            ))}
          </Section>
          <TextField label="City" value={draft.city ?? ""} onChangeText={(city) => set({ city })} placeholder="e.g. Accra, Kumasi, Tema" autoCapitalize="words" />
          <View style={styles.priceRow}>
            <View style={styles.priceField}>
              <TextField label="Min price (GH₵)" value={draft.minPrice ?? ""} onChangeText={(minPrice) => set({ minPrice })} keyboardType="numeric" error={errors.minPrice} />
            </View>
            <View style={styles.priceField}>
              <TextField label="Max price (GH₵)" value={draft.maxPrice ?? ""} onChangeText={(maxPrice) => set({ maxPrice })} keyboardType="numeric" error={errors.maxPrice} />
            </View>
          </View>
          <AppText variant="caption">Price filters match listings priced in cedis. Listings priced in other currencies are excluded while a price filter is set.</AppText>
          <Section title="Bedrooms (at least)">
            {BEDROOM_OPTIONS.map((value) => (
              <Chip key={value} label={`${value}+`} selected={draft.bedroomsMin === value} onPress={() => toggle("bedroomsMin", value)} />
            ))}
          </Section>
          <Section title="Bathrooms (at least)">
            {BATHROOM_OPTIONS.map((value) => (
              <Chip key={value} label={`${value}+`} selected={draft.bathroomsMin === value} onPress={() => toggle("bathroomsMin", value)} />
            ))}
          </Section>
        </ScrollView>
        <View style={styles.sheetFooter}>
          <View style={styles.footerButton}>
            <Button label="Clear" variant="secondary" onPress={() => setDraft({})} />
          </View>
          <View style={styles.footerButton}>
            <Button label="Show results" onPress={() => onApply(draft)} disabled={Object.keys(errors).length > 0} testID="apply-filters" />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label">{title}</AppText>
      <View style={styles.sectionChips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, paddingVertical: spacing.sm },
  filterButton: {
    minWidth: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    gap: 4,
  },
  filterButtonActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  filterCount: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  total: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  list: { padding: spacing.xl, paddingTop: spacing.md, gap: spacing.lg, flexGrow: 1 },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.xl, paddingBottom: spacing.md },
  sheetBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  priceRow: { flexDirection: "row", gap: spacing.md },
  priceField: { flex: 1 },
  sheetFooter: { flexDirection: "row", gap: spacing.md, padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.hairline },
  footerButton: { flex: 1 },
});
