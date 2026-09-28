import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { useApi } from "@/api/provider";
import { useListingCollection } from "@/api/queries";
import type { PublicListing } from "@/api/types";
import { VerifiedBadge } from "@/components/listing-card";
import { SaveButton } from "@/components/save-button";
import { AppText } from "@/components/ui";
import { formatFacts, formatListingPrice, formatLocation, isVerified, listingPhotos } from "@/marketplace/format";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";
import { SectionHeading } from "./section-heading";

const MAX_CARDS = 6;
const CARD_GAP = 12;
/** A listing counts as new for this long after it was published. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Listings the Home rail may show. The public API already returns only published, verified,
 * currently available listings; the verification check here is a second guard, not a filter
 * the rail relies on.
 */
export function homeListings(items: PublicListing[], max = MAX_CARDS) {
  return items.filter(isVerified).slice(0, max);
}

export function isNewListing(listing: Pick<PublicListing, "publishedAt">, now = Date.now()) {
  if (!listing.publishedAt) return false;
  const published = Date.parse(listing.publishedAt);
  return Number.isFinite(published) && now - published >= 0 && now - published < NEW_FOR_MS;
}

/**
 * "Properties on NesAfric": the newest real listings as a horizontal card rail with a peek of
 * the next card. Shares the carousel's "newest" query, so Home makes no extra request for it.
 */
export function PropertiesOnNesAfric() {
  const { width } = useWindowDimensions();
  const newest = useListingCollection("newest", {});
  const items = homeListings(newest.data?.items ?? []);
  // Leaves ~20% of the next card visible so the rail reads as scrollable.
  const cardWidth = Math.round(Math.min((width - HOME_GUTTER) * 0.78, 320));

  return (
    <View style={styles.section}>
      <SectionHeading
        title="Properties on NesAfric"
        action={items.length ? { label: "See all", onPress: () => openSearch({}) } : undefined}
      />
      {newest.isPending ? (
        <View style={styles.row} accessibilityLabel="Loading properties">
          {[0, 1].map((key) => (
            <View key={key} style={[styles.skeleton, { width: cardWidth }]} />
          ))}
        </View>
      ) : newest.isError && !items.length ? (
        <View style={styles.notice}>
          <AppText style={styles.noticeText}>Properties couldn&apos;t load right now.</AppText>
          <Pressable accessibilityRole="button" onPress={() => void newest.refetch()} hitSlop={8}>
            <AppText style={styles.retry}>Try again</AppText>
          </Pressable>
        </View>
      ) : !items.length ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="home-search-outline" size={22} color={colors.muted} />
          <AppText style={styles.noticeText}>New properties will appear here.</AppText>
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(listing) => listing.id}
          accessibilityLabel="Properties on NesAfric"
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={cardWidth + CARD_GAP}
          snapToAlignment="start"
          contentContainerStyle={styles.row}
          renderItem={({ item }) => <HomePropertyCard listing={item} width={cardWidth} />}
        />
      )}
    </View>
  );
}

function HomePropertyCard({ listing, width }: { listing: PublicListing; width: number }) {
  const { apiUrl } = useApi();
  const photo = listingPhotos(listing.media, apiUrl)[0];
  const price = formatListingPrice(listing);
  const location = formatLocation(listing.location);
  const facts = formatFacts(listing.attributes);
  const type = listing.listingType === "RENT" ? "For rent" : "For sale";

  return (
    <Link href={{ pathname: "/listing/[id]", params: { id: listing.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[listing.title, type, price, location].filter(Boolean).join(", ")}
        // Expo Router's `Link asChild` merges the child's style as an object, which silently drops
        // a function style — so the card style is a flat object and press feedback lives inside.
        style={StyleSheet.flatten([styles.card, { width }])}
      >
        {({ pressed }) => (
          <View style={pressed && styles.pressed}>
            <View style={styles.photo}>
              {photo ? (
                <Image
                  source={{ uri: photo.url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={listing.id}
                  accessibilityLabel={photo.altText ?? listing.title}
                />
              ) : (
                <View style={styles.noPhoto}>
                  <MaterialCommunityIcons name="image-outline" size={26} color={colors.muted} />
                </View>
              )}
              <View style={styles.badges}>
                <AppText style={styles.typeBadge}>{type}</AppText>
                {isNewListing(listing) ? <AppText style={styles.newBadge}>New</AppText> : null}
              </View>
              <View style={styles.save}>
                <SaveButton listing={listing} size={18} />
              </View>
            </View>
            <View style={styles.body}>
              <AppText style={styles.price} numberOfLines={1}>{price ?? "Price on request"}</AppText>
              <AppText style={styles.title} numberOfLines={1}>{listing.title}</AppText>
              {location ? (
                <View style={styles.locationRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.muted} />
                  <AppText style={styles.meta} numberOfLines={1}>{location}</AppText>
                </View>
              ) : null}
              <View style={styles.footer}>
                <AppText style={[styles.meta, styles.facts]} numberOfLines={1}>{facts ?? ""}</AppText>
                {isVerified(listing) ? <VerifiedBadge /> : null}
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", paddingHorizontal: HOME_GUTTER, gap: CARD_GAP, paddingVertical: 2 },
  skeleton: { height: 262, borderRadius: radii.panel, backgroundColor: colors.cream },
  notice: {
    marginHorizontal: HOME_GUTTER,
    minHeight: 72,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 14,
  },
  noticeText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted, textAlign: "center" },
  retry: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.forest },
  card: {
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    overflow: "hidden",
  },
  pressed: { opacity: 0.92 },
  photo: { aspectRatio: 16 / 10, backgroundColor: colors.cream },
  noPhoto: { flex: 1, alignItems: "center", justifyContent: "center" },
  badges: { position: "absolute", top: 10, left: 10, flexDirection: "row", gap: 6 },
  typeBadge: {
    overflow: "hidden",
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: colors.forestDeep,
    color: "#ffffff",
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 15,
  },
  newBadge: {
    overflow: "hidden",
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: colors.elevated,
    color: colors.forestDeep,
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 15,
  },
  save: { position: "absolute", top: 6, right: 6 },
  body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 2 },
  price: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.forestDeep },
  title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.ink },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  meta: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  facts: { flex: 1 },
});
