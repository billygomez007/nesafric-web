import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { useListingCollection } from "@/api/queries";
import type { PublicListing } from "@/api/types";
import { AppText } from "@/components/ui";
import { HOME_GUTTER } from "@/home/components/layout";
import { SectionHeading } from "@/home/components/section-heading";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { CityTileCard, CompactRow, FeaturedCard, GridCard, RailCard } from "./cards";
import { eligible, type CityTile, type DiscoveryCollection } from "./collections";

const GAP = 12;
/** Space under every section; a section that renders nothing takes no space at all. */
export const SECTION_SPACING = 28;

/** Rail cards show about 1.6 cards: the next one always peeks, so the rail reads as swipeable. */
function railWidth(screen: number) {
  return Math.round(Math.min((screen - HOME_GUTTER) * 0.62, 280));
}

/** Placeholder with the shape of the section that is loading, so nothing jumps when it arrives. */
export function SectionSkeleton({ layout, label }: { layout: DiscoveryCollection["layout"]; label: string }) {
  const { width } = useWindowDimensions();
  const card = railWidth(width);
  return (
    <View style={styles.section} accessibilityLabel={label}>
      <View style={[styles.skeletonTitle, { marginHorizontal: HOME_GUTTER }]} />
      {layout === "compact" ? (
        <View style={[styles.skeletonBlock, styles.gutter, { height: 196 }]} />
      ) : layout === "grid" ? (
        <View style={[styles.gridRow, styles.gutter]}>
          {[0, 1].map((key) => <View key={key} style={[styles.skeletonBlock, styles.grow, { height: 170 }]} />)}
        </View>
      ) : (
        <View style={styles.railRow}>
          {[0, 1].map((key) => <View key={key} style={[styles.skeletonBlock, { width: card, height: 250 }]} />)}
        </View>
      )}
    </View>
  );
}

/** Draws a collection's listings in its layout, with its heading and "See all". */
export function CollectionBody({ collection, items }: { collection: DiscoveryCollection; items: PublicListing[] }) {
  const { width } = useWindowDimensions();
  const seeAll = collection.seeAll;
  return (
    <View style={styles.section} testID={`collection-${collection.key}`}>
      <SectionHeading title={collection.title} subtitle={collection.subtitle} action={seeAll ? { label: "See all", onPress: () => openSearch(seeAll) } : undefined} />
      {collection.layout === "grid" ? (
        <View style={[styles.gridRow, styles.gutter, styles.wrap]}>
          {items.slice(0, 4).map((listing) => (
            <GridCard key={listing.id} listing={listing} width={Math.floor((width - HOME_GUTTER * 2 - GAP) / 2)} />
          ))}
        </View>
      ) : collection.layout === "compact" ? (
        <View style={[styles.rows, styles.gutter]}>
          {items.slice(0, 4).map((listing, index, shown) => <CompactRow key={listing.id} listing={listing} last={index === shown.length - 1} />)}
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(listing) => listing.id}
          accessibilityLabel={collection.title}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={railWidth(width) + GAP}
          snapToAlignment="start"
          contentContainerStyle={styles.railRow}
          initialNumToRender={3}
          windowSize={3}
          renderItem={({ item }) => <RailCard listing={item} width={railWidth(width)} />}
        />
      )}
    </View>
  );
}

/**
 * A collection that fetches itself. It is mounted only when the feed is about to show it, so lower
 * collections cost nothing until someone scrolls towards them. With too few listings, or if the
 * request fails, the whole section is left out: Home never shows an empty or broken shelf.
 */
export function CollectionSection({ collection }: { collection: DiscoveryCollection }) {
  const query = useListingCollection(collection.key, collection.filters, collection.size);
  if (query.isPending) return <SectionSkeleton layout={collection.layout} label={`Loading ${collection.title}`} />;
  const items = eligible(query.data?.items ?? [], collection.size);
  if (items.length < collection.minItems) return null;
  return <CollectionBody collection={collection} items={items} />;
}

/** One large Top Ad card; more than one become a swipeable row of large cards. */
export function FeaturedSection({ items }: { items: PublicListing[] }) {
  const { width } = useWindowDimensions();
  if (!items.length) return null;
  const only = items.length === 1;
  return (
    <View style={styles.section} testID="collection-featured">
      <SectionHeading title="Featured" subtitle="Top Ads from NesAfric advertisers" />
      {only ? (
        <View style={styles.gutter}>
          <FeaturedCard listing={items[0]} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(listing) => listing.id}
          accessibilityLabel="Featured"
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={Math.round((width - HOME_GUTTER * 2) * 0.9) + GAP}
          contentContainerStyle={styles.railRow}
          renderItem={({ item }) => (
            <View style={{ width: Math.round((width - HOME_GUTTER * 2) * 0.9) }}>
              <FeaturedCard listing={item} />
            </View>
          )}
        />
      )}
    </View>
  );
}

/** "Explore by city": cities real listings are in, each opening Search for that city. */
export function CitiesSection({ tiles }: { tiles: CityTile[] }) {
  if (tiles.length < 2) return null;
  return (
    <View style={styles.section} testID="collection-cities">
      <SectionHeading title="Explore by city" />
      <FlatList
        horizontal
        data={tiles}
        keyExtractor={(tile) => tile.city}
        accessibilityLabel="Explore by city"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railRow}
        renderItem={({ item }) => <CityTileCard city={item.city} listing={item.listing} onPress={() => openSearch({ city: item.city, country: item.listing.location.countryCode })} />}
      />
    </View>
  );
}

/** The one collection that keeps its shelf when empty or failing: it tells people why nothing is there. */
export function NewestNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <View style={styles.section}>
      <SectionHeading title="Newly listed" />
      <View style={[styles.notice, styles.gutter]}>
        {failed ? (
          <>
            <AppText style={styles.noticeText}>Properties couldn&apos;t load right now.</AppText>
            <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
              <AppText style={styles.retry}>Try again</AppText>
            </Pressable>
          </>
        ) : (
          <AppText style={styles.noticeText}>New properties will appear here.</AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginBottom: SECTION_SPACING },
  gutter: { marginHorizontal: HOME_GUTTER },
  grow: { flex: 1 },
  wrap: { flexWrap: "wrap" },
  railRow: { flexDirection: "row", paddingHorizontal: HOME_GUTTER, gap: GAP, paddingVertical: 2 },
  gridRow: { flexDirection: "row", gap: GAP },
  rows: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  skeletonTitle: { width: 140, height: 18, borderRadius: 4, backgroundColor: colors.cream },
  skeletonBlock: { borderRadius: radii.panel, backgroundColor: colors.cream },
  notice: { minHeight: 72, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, alignItems: "center", justifyContent: "center", gap: 6, padding: 14 },
  noticeText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted, textAlign: "center" },
  retry: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.action },
});
