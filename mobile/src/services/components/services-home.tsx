import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { useProviderCollection, useServiceCategories } from "@/api/service-queries";
import { AppText, Button } from "@/components/ui";
import { HOME_GUTTER } from "@/home/components/layout";
import { SectionHeading } from "@/home/components/section-heading";
import { orderCategories } from "@/services/format";
import { openProviderSearch } from "@/services/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { CategoryTiles } from "./category-tiles";
import { InlineState } from "./inline-state";
import { ProviderCard } from "./provider-card";

const COLLAPSED_CATEGORIES = 8;
const HOME_PROVIDERS = 5;

/**
 * Service Provider Marketplace home: heading and provider search (run by the server on Search) →
 * services (from the server's category list) → providers in the server's ranking order. No sample providers: an empty or
 * failed response is shown as such.
 */
export function ServicesHome() {
  const categoriesQuery = useServiceCategories();
  const providersQuery = useProviderCollection({}, HOME_PROVIDERS);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);

  const ordered = useMemo(() => orderCategories(categoriesQuery.data ?? []), [categoriesQuery.data]);
  const visible = expanded ? ordered : ordered.slice(0, COLLAPSED_CATEGORIES);

  /** Hands the text to Search, where the server searches providers. */
  function submit() {
    const q = text.trim();
    if (q) openProviderSearch({ q });
  }

  const providers = providersQuery.data?.items ?? [];
  const total = providersQuery.data?.pagination.total ?? 0;

  return (
    <>
      <View style={styles.hero}>
        <AppText accessibilityRole="header" style={styles.title}>Service Providers</AppText>
        <AppText style={styles.lead}>Find trusted professionals for your property.</AppText>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Search plumbers, electricians, cleaners…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            accessibilityLabel="Search service providers"
            onSubmitEditing={submit}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading title="Popular services" />
        <View style={styles.gutter}>
          {!categoriesQuery.data ? (
            <InlineState loading={categoriesQuery.isPending} error={categoriesQuery.error} onRetry={() => categoriesQuery.refetch()} testID="service-categories-state" />
          ) : !ordered.length ? (
            <InlineState emptyTitle="No services listed yet" emptyMessage="Service categories will appear here once NesAfric publishes them." />
          ) : (
            <View style={styles.categories}>
              <CategoryTiles categories={visible} onSelect={(category) => openProviderSearch({ service: category.key })} />
              {ordered.length > COLLAPSED_CATEGORIES ? (
                <Button
                  label={expanded ? "Show fewer services" : `All services (${ordered.length})`}
                  variant="secondary"
                  onPress={() => setExpanded((value) => !value)}
                />
              ) : null}
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading
          title="Providers on NesAfric"
          subtitle="Verified by NesAfric, ranked by their record on the platform."
          action={providers.length ? { label: "See all", onPress: () => openProviderSearch() } : undefined}
        />
        <View style={[styles.gutter, styles.providers]}>
          {!providersQuery.data ? (
            <InlineState loading={providersQuery.isPending} error={providersQuery.error} onRetry={() => providersQuery.refetch()} testID="service-providers-state" />
          ) : !providers.length ? (
            <InlineState
              testID="service-providers-empty"
              emptyTitle="No service providers listed yet"
              emptyMessage="Verified providers appear here as soon as they publish a marketplace profile."
            />
          ) : (
            <>
              {providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}
              {total > providers.length ? (
                <Button label={`See all ${total.toLocaleString()} providers`} variant="dark" onPress={() => openProviderSearch()} />
              ) : null}
            </>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: HOME_GUTTER, gap: 6 },
  title: { fontFamily: fonts.bold, fontSize: 25, lineHeight: 31, letterSpacing: -0.4, color: colors.forestDeep },
  lead: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.muted, marginBottom: 6 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    shadowColor: "#102d2a",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  section: { gap: 10 },
  gutter: { paddingHorizontal: HOME_GUTTER },
  categories: { gap: 10 },
  providers: { gap: 12 },
});
