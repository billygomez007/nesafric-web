import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useProviderSearch, useServiceCategories } from "@/api/service-queries";
import { Chip } from "@/components/chip";
import { QueryState } from "@/components/query-state";
import { AppText, Button, StateMessage, TextField } from "@/components/ui";
import {
  activeProviderFilterCount,
  AVAILABILITY_OPTIONS,
  MINIMUM_RATING_OPTIONS,
  PROVIDER_TYPE_OPTIONS,
  type ProviderFilters,
} from "@/marketplace/provider-filters";
import { orderCategories } from "@/services/format";
import { useDebouncedValue } from "@/services/use-debounced-value";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { ProviderCard } from "./provider-card";

/**
 * Search, Service Providers mode. Free text is sent to the server as `q` (after typing settles,
 * or at once on submit) together with the service chip and filters; the server searches names,
 * descriptions, services and areas and keeps its ranking order. Nothing is filtered on the device.
 */
export function ProviderSearchView({ initial }: { initial: ProviderFilters }) {
  const [filters, setFilters] = useState<ProviderFilters>(initial);
  const [text, setText] = useState(initial.q ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settled, flush] = useDebouncedValue(text);

  // Typing settles into the query without a request per keystroke.
  const typedQ = settled.trim().replace(/\s+/g, " ") || undefined;
  const effective = useMemo(() => ({ ...filters, q: typedQ }), [filters, typedQ]);

  const categoriesQuery = useServiceCategories();
  const categories = useMemo(() => orderCategories(categoriesQuery.data ?? []), [categoriesQuery.data]);
  const selected = categories.find((category) => category.key === filters.service);

  const search = useProviderSearch(effective);
  const items = search.data?.pages.flatMap((page) => page.items) ?? [];
  const total = search.data?.pages[0]?.pagination.total;
  const count = activeProviderFilterCount(filters);

  function selectService(key: string | undefined) {
    setFilters((current) => ({ ...current, service: key }));
  }

  function submit() {
    // Submitting skips the wait.
    flush();
  }

  const serviceName = selected?.name ?? (filters.service ? "this service" : null);
  const q = effective.q;
  const narrowed = Boolean(q || count || filters.service);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            placeholder="Search plumbers, electricians, cleaners…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            accessibilityLabel="Search service providers"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={count ? `Provider filters, ${count} active` : "Provider filters"}
          onPress={() => setFiltersOpen(true)}
          style={[styles.filterButton, count > 0 && styles.filterButtonActive]}
        >
          <Ionicons name="options-outline" size={20} color={count ? colors.white : colors.ink} />
          {count ? <AppText style={styles.filterCount}>{count}</AppText> : null}
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.chipRow} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled" accessibilityLabel="Services">
        <Chip label="All services" selected={!filters.service} onPress={() => selectService(undefined)} />
        {categories.map((category) => (
          <Chip key={category.id} label={category.name} selected={category.key === filters.service} onPress={() => selectService(category.key === filters.service ? undefined : category.key)} />
        ))}
      </ScrollView>

      {total !== undefined ? (
        <AppText variant="caption" style={styles.total} testID="provider-total">
          {total === 1 ? "1 verified provider" : `${total.toLocaleString()} verified providers`}
          {serviceName ? ` for ${serviceName}` : ""}
          {q ? ` matching “${q}”` : ""}
        </AppText>
      ) : null}

      {!search.data ? (
        <QueryState isPending={search.isPending} error={search.error} onRetry={() => search.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(provider) => provider.id}
          renderItem={({ item }) => <ProviderCard provider={item} focusCategoryId={selected?.id} />}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.5}
          onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && search.fetchNextPage()}
          ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : null}
          ListEmptyComponent={
            <StateMessage
              title={q ? `No providers match “${q}”` : serviceName ? `No ${serviceName} providers yet` : narrowed ? "No matching providers" : "No service providers listed yet"}
              message={
                q
                  ? "Try another word — a trade like “plumber”, a provider’s name or an area."
                  : narrowed
                    ? "No verified provider matches these filters yet. Try another area or fewer filters."
                    : "Verified providers appear here as soon as they publish a marketplace profile."
              }
              actionLabel={narrowed ? "Clear search and filters" : undefined}
              onAction={
                narrowed
                  ? () => {
                    setFilters({});
                    setText("");
                  }
                  : undefined
              }
            />
          }
          refreshControl={<RefreshControl refreshing={search.isRefetching && !search.isFetchingNextPage} onRefresh={() => search.refetch()} tintColor={colors.brand} />}
          initialNumToRender={4}
          windowSize={7}
        />
      )}

      {filtersOpen ? (
        <ProviderFilterSheet
          filters={filters}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFilters({ ...next, q: undefined, service: filters.service });
            setFiltersOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function ProviderFilterSheet({ filters, onClose, onApply }: { filters: ProviderFilters; onClose: () => void; onApply: (filters: ProviderFilters) => void }) {
  const [draft, setDraft] = useState(filters);
  const set = (patch: Partial<ProviderFilters>) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => set({ [key]: draft[key] === value ? undefined : value } as Partial<ProviderFilters>);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <AppText variant="heading">Provider filters</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={26} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Section title="Provider type">
            {PROVIDER_TYPE_OPTIONS.map((option) => (
              <Chip key={option.value} label={option.label} selected={draft.providerType === option.value} onPress={() => toggle("providerType", option.value)} />
            ))}
          </Section>
          <Section title="Availability">
            {AVAILABILITY_OPTIONS.map((option) => (
              <Chip key={option.value} label={option.label} selected={draft.availability === option.value} onPress={() => toggle("availability", option.value)} />
            ))}
          </Section>
          <Section title="Rating (at least)">
            {MINIMUM_RATING_OPTIONS.map((value) => (
              <Chip key={value} label={`${value}★`} selected={draft.minimumRating === value} onPress={() => toggle("minimumRating", value)} />
            ))}
          </Section>
          <AppText variant="label">Area served</AppText>
          <TextField label="Region" value={draft.region ?? ""} onChangeText={(region) => set({ region })} placeholder="e.g. Greater Accra" autoCapitalize="words" />
          <TextField label="City" value={draft.city ?? ""} onChangeText={(city) => set({ city })} placeholder="e.g. Accra, Kumasi, Tema" autoCapitalize="words" />
          <TextField label="District" value={draft.district ?? ""} onChangeText={(district) => set({ district })} placeholder="e.g. East Legon" autoCapitalize="words" />
          <AppText variant="caption">Area filters match providers who cover that area in Ghana, including those serving the whole region or country.</AppText>
        </ScrollView>
        <View style={styles.sheetFooter}>
          <View style={styles.footerButton}>
            <Button label="Clear" variant="secondary" onPress={() => setDraft({})} />
          </View>
          <View style={styles.footerButton}>
            <Button label="Show providers" onPress={() => onApply(draft)} testID="apply-provider-filters" />
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
  flex: { flex: 1 },
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
  chipRow: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md, alignItems: "center" },
  total: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  list: { padding: spacing.xl, paddingTop: spacing.md, gap: spacing.lg, flexGrow: 1 },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.xl, paddingBottom: spacing.md },
  sheetBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sheetFooter: { flexDirection: "row", gap: spacing.md, padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.hairline },
  footerButton: { flex: 1 },
});
