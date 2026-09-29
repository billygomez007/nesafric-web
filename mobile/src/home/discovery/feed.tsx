import { useMemo, type ReactElement } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { useListingCollection } from "@/api/queries";
import { AdvancedSearchCTA } from "@/home/components/advanced-search-cta";
import { HOME_SECTION_GAP } from "@/home/components/layout";
import { TrustedCompanies } from "@/home/components/trusted-companies";
import { colors } from "@/theme/tokens";
import { CATEGORY_COLLECTIONS, cityCollection, fetchSize, NEWEST, organic, popularCities, topAds, type DiscoveryCollection } from "./collections";
import { SECTION_SPACING, CitiesSection, CollectionBody, CollectionSection, FeaturedSection, NewestNotice, SectionSkeleton } from "./section";

/** How many listings "Newly listed" shows; the rest of the newest page feeds the city tiles. */
const NEWEST_SHOWN = 8;

type FeedItem =
  | { key: string; type: "featured" }
  | { key: string; type: "newest" }
  | { key: string; type: "cities" }
  | { key: string; type: "companies" }
  | { key: string; type: "collection"; collection: DiscoveryCollection }
  | { key: string; type: "advanced" };

/**
 * The Properties Home feed: one vertical, virtualised list of discovery sections under the header.
 *
 * Loading: only the newest-listings query runs up front (it drives the Top Ad hero, "Newly listed"
 * and the city tiles). Every other collection fetches inside its own section, and the list mounts
 * sections only as they approach the screen, so lower shelves cost nothing until someone scrolls.
 * Each query is cached and de-duplicated by React Query; pull-to-refresh invalidates them all.
 */
export function DiscoveryFeed({ header, refreshing, onRefresh, bottomInset }: { header: ReactElement; refreshing: boolean; onRefresh: () => void; bottomInset: number }) {
  const newest = useListingCollection(NEWEST.key, NEWEST.filters, fetchSize(NEWEST));
  const all = useMemo(() => newest.data?.items ?? [], [newest.data]);
  const featured = useMemo(() => topAds(all), [all]);
  const cities = useMemo(() => popularCities(all), [all]);

  const items = useMemo<FeedItem[]>(() => {
    const topCity = cities[0]?.city;
    const [first, second, ...rest] = CATEGORY_COLLECTIONS;
    const collection = (c: DiscoveryCollection): FeedItem => ({ key: c.key, type: "collection", collection: c });
    return [
      { key: "featured", type: "featured" },
      { key: "newest", type: "newest" },
      { key: "cities", type: "cities" },
      collection(first),
      { key: "companies", type: "companies" },
      collection(second),
      ...(topCity ? [collection(cityCollection(topCity))] : []),
      ...rest.map(collection),
      { key: "advanced", type: "advanced" },
    ];
  }, [cities]);

  function renderItem({ item }: { item: FeedItem }) {
    switch (item.type) {
      case "featured":
        return <FeaturedSection items={featured} />;
      case "newest": {
        if (newest.isPending) return <SectionSkeleton layout="rail" label="Loading properties" />;
        // Organic only: Top Ads appear in Featured, labelled, and nowhere else.
        const shown = organic(all, NEWEST_SHOWN);
        if (!shown.length) return <NewestNotice failed={newest.isError} onRetry={() => void newest.refetch()} />;
        return <CollectionBody collection={NEWEST} items={shown} />;
      }
      case "cities":
        return <CitiesSection tiles={cities} />;
      case "companies":
        return <View style={styles.block}><TrustedCompanies /></View>;
      case "collection":
        return <CollectionSection collection={item.collection} />;
      case "advanced":
        return <View style={styles.block}><AdvancedSearchCTA /></View>;
    }
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
      // Sections are tall: a few at a time, and only a couple of screens ahead of the viewport.
      initialNumToRender={4}
      maxToRenderPerBatch={2}
      windowSize={5}
      testID="home-feed"
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 4 },
  header: { gap: HOME_SECTION_GAP, marginBottom: HOME_SECTION_GAP + 8 },
  // Spacing lives in each section (see SECTION_SPACING), so a left-out section leaves no gap.
  block: { marginBottom: SECTION_SPACING },
});
