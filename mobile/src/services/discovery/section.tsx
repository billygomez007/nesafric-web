import { FlatList, StyleSheet, useWindowDimensions, View } from "react-native";

import { useProviderCollection } from "@/api/service-queries";
import type { PublicProvider } from "@/api/types";
import { HOME_GUTTER } from "@/home/components/layout";
import { SectionHeading } from "@/home/components/section-heading";
import { SECTION_SPACING, SectionSkeleton } from "@/home/discovery/section";
import { DEFAULT_COUNTRY } from "@/marketplace/filters";
import { openProviderSearch } from "@/services/navigation";
import { colors, radii } from "@/theme/tokens";
import { ProviderCityTile, ProviderCompactRow, ProviderGridCard, ProviderRailCard } from "./cards";
import { shown, type ProviderCollection } from "./collections";

const GAP = 12;

/** Rail cards show about 1.6 cards, so the next one always peeks (same as Properties Home). */
function railWidth(screen: number) {
  return Math.round(Math.min((screen - HOME_GUTTER) * 0.62, 280));
}

/** Draws a collection's providers in its layout, with its heading and "See all". */
export function ProviderCollectionBody({ collection, items }: { collection: ProviderCollection; items: PublicProvider[] }) {
  const { width } = useWindowDimensions();
  const seeAll = collection.seeAll;
  const focusKey = collection.filters.service;
  const cardID = (provider: PublicProvider) => `services-card-${collection.key}-${provider.id}`;
  return (
    <View style={styles.section} testID={`services-collection-${collection.key}`}>
      <SectionHeading title={collection.title} subtitle={collection.subtitle} action={seeAll ? { label: "See all", onPress: () => openProviderSearch(seeAll) } : undefined} />
      {collection.layout === "grid" ? (
        <View style={[styles.gridRow, styles.gutter]}>
          {items.slice(0, 4).map((provider) => (
            <ProviderGridCard key={provider.id} provider={provider} focusKey={focusKey} testID={cardID(provider)} width={Math.floor((width - HOME_GUTTER * 2 - GAP) / 2)} />
          ))}
        </View>
      ) : collection.layout === "compact" ? (
        <View style={[styles.rows, styles.gutter]}>
          {items.slice(0, 4).map((provider, index, list) => (
            <ProviderCompactRow key={provider.id} provider={provider} focusKey={focusKey} testID={cardID(provider)} last={index === list.length - 1} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(provider) => provider.id}
          accessibilityLabel={collection.title}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={railWidth(width) + GAP}
          snapToAlignment="start"
          contentContainerStyle={styles.railRow}
          initialNumToRender={3}
          windowSize={3}
          renderItem={({ item }) => <ProviderRailCard provider={item} focusKey={focusKey} testID={cardID(item)} width={railWidth(width)} />}
        />
      )}
    </View>
  );
}

/**
 * A collection that fetches itself, mounted only when the feed is about to show it. With too few
 * matching providers, or if the request fails, the whole section is left out: Home never shows an
 * empty or broken shelf.
 */
export function ProviderCollectionSection({ collection }: { collection: ProviderCollection }) {
  const query = useProviderCollection(collection.filters, collection.size);
  if (query.isPending) return <SectionSkeleton layout={collection.layout} label={`Loading ${collection.title}`} />;
  const items = shown(collection, query.data?.items ?? []);
  if (items.length < collection.minItems) return null;
  return <ProviderCollectionBody collection={collection} items={items} />;
}

/** "Find providers by city": cities real providers serve, each opening Search for that city. */
export function ProviderCitiesSection({ cities }: { cities: string[] }) {
  if (cities.length < 2) return null;
  return (
    <View style={styles.section} testID="services-collection-cities">
      <SectionHeading title="Find providers by city" />
      <FlatList
        horizontal
        data={cities}
        keyExtractor={(city) => city}
        accessibilityLabel="Find providers by city"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railRow}
        renderItem={({ item }) => <ProviderCityTile city={item} onPress={() => openProviderSearch({ city: item, country: DEFAULT_COUNTRY })} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginBottom: SECTION_SPACING },
  gutter: { marginHorizontal: HOME_GUTTER },
  railRow: { flexDirection: "row", paddingHorizontal: HOME_GUTTER, gap: GAP, paddingVertical: 2 },
  gridRow: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  rows: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
});
