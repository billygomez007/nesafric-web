import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useApi } from "@/api/provider";
import type { PublicListing } from "@/api/types";
import { VerifiedBadge } from "@/components/listing-card";
import { SaveButton } from "@/components/save-button";
import { AppText } from "@/components/ui";
import { formatFacts, formatListingPrice, formatLocation, isVerified, listingPhotos } from "@/marketplace/format";
import { stayLabel } from "@/marketplace/listing-categories";
import { colors, fonts, radii } from "@/theme/tokens";

/** A listing counts as new for this long after it was published. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

export function isNewListing(listing: Pick<PublicListing, "publishedAt">, now = Date.now()) {
  if (!listing.publishedAt) return false;
  const published = Date.parse(listing.publishedAt);
  return Number.isFinite(published) && now - published >= 0 && now - published < NEW_FOR_MS;
}

function describe(listing: PublicListing) {
  // A hotel or short stay is labelled as what it is (priced per night), not as a rental.
  const type = stayLabel(listing.category) ?? (listing.listingType === "RENT" ? "For rent" : "For sale");
  const nightly = formatListingPrice(listing);
  const price = nightly && listing.category.toUpperCase() === "HOTEL" ? `From ${nightly}` : nightly;
  const location = formatLocation(listing.location);
  return { type, price, location, facts: formatFacts(listing.attributes), label: [listing.title, type, price, location].filter(Boolean).join(", ") };
}

/**
 * The tappable shell shared by every card: opens the listing. Expo Router's `Link asChild` merges
 * the child's style as an object and drops a function style, so press feedback lives inside.
 */
function ListingLink({ listing, label, style, testID, children }: { listing: PublicListing; label: string; style: object; testID?: string; children: ReactNode }) {
  return (
    <Link href={{ pathname: "/listing/[id]", params: { id: listing.id } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} style={style} testID={testID}>
        {({ pressed }) => <View style={[styles.fill, pressed && styles.pressed]}>{children}</View>}
      </Pressable>
    </Link>
  );
}

function Photo({ listing, style, children }: { listing: PublicListing; style: object; children?: ReactNode }) {
  const { apiUrl } = useApi();
  const photo = listingPhotos(listing.media, apiUrl)[0];
  return (
    <View style={[styles.photo, style]}>
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
          <MaterialCommunityIcons name="image-outline" size={24} color={colors.muted} />
        </View>
      )}
      {children}
    </View>
  );
}

function Location({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.locationRow}>
      <MaterialCommunityIcons name="map-marker-outline" size={13} color={colors.muted} />
      <AppText style={styles.meta} numberOfLines={1}>{text}</AppText>
    </View>
  );
}

/** Standard rail card: photo, type/new badges, save, price, title, location, facts. */
export const RailCard = memo(function RailCard({ listing, width }: { listing: PublicListing; width: number }) {
  const info = describe(listing);
  return (
    <ListingLink listing={listing} label={info.label} style={StyleSheet.flatten([styles.card, { width }])}>
      <Photo listing={listing} style={styles.railPhoto}>
        <View style={styles.badges}>
          <AppText style={styles.typeBadge}>{info.type}</AppText>
          {isNewListing(listing) ? <AppText style={styles.lightBadge}>New</AppText> : null}
        </View>
        <View style={styles.save}>
          <SaveButton listing={listing} size={18} />
        </View>
      </Photo>
      <View style={styles.body}>
        <AppText style={styles.price} numberOfLines={1}>{info.price ?? "Price on request"}</AppText>
        <AppText style={styles.title} numberOfLines={1}>{listing.title}</AppText>
        <Location text={info.location} />
        <View style={styles.footer}>
          <AppText style={[styles.meta, styles.grow]} numberOfLines={1}>{info.facts}</AppText>
          {isVerified(listing) ? <VerifiedBadge /> : null}
        </View>
      </View>
    </ListingLink>
  );
});

/**
 * Editorial hero for an admin-pinned Top Ad: one large photo with the facts beneath it, never text
 * over the photo. It is labelled "Top Ad" like the website, because it is a paid placement.
 */
export const FeaturedCard = memo(function FeaturedCard({ listing }: { listing: PublicListing }) {
  const info = describe(listing);
  return (
    <ListingLink listing={listing} label={`Top Ad, ${info.label}`} style={styles.featured} testID={`featured-${listing.id}`}>
      <Photo listing={listing} style={styles.featuredPhoto}>
        <View style={styles.badges}>
          <AppText style={styles.lightBadge}>Top Ad</AppText>
          <AppText style={styles.typeBadge}>{info.type}</AppText>
        </View>
        <View style={styles.save}>
          <SaveButton listing={listing} size={20} />
        </View>
      </Photo>
      <View style={styles.featuredBody}>
        <View style={styles.grow}>
          <AppText style={styles.featuredTitle} numberOfLines={2}>{listing.title}</AppText>
          <Location text={info.location} />
          {info.facts ? <AppText style={styles.meta} numberOfLines={1}>{info.facts}</AppText> : null}
        </View>
        <AppText style={styles.featuredPrice} numberOfLines={1}>{info.price ?? "Price on request"}</AppText>
      </View>
    </ListingLink>
  );
});

/** Two-column grid card: square-ish photo, price and title only. */
export const GridCard = memo(function GridCard({ listing, width }: { listing: PublicListing; width: number }) {
  const info = describe(listing);
  return (
    <ListingLink listing={listing} label={info.label} style={StyleSheet.flatten([styles.card, { width }])}>
      <Photo listing={listing} style={styles.gridPhoto}>
        <View style={styles.saveSmall}>
          <SaveButton listing={listing} size={16} />
        </View>
      </Photo>
      <View style={styles.gridBody}>
        <AppText style={styles.gridPrice} numberOfLines={1}>{info.price ?? "Price on request"}</AppText>
        <AppText style={styles.meta} numberOfLines={1}>{listing.title}</AppText>
      </View>
    </ListingLink>
  );
});

/** Compact row: small photo on the left, the essentials on the right. */
export const CompactRow = memo(function CompactRow({ listing, last }: { listing: PublicListing; last: boolean }) {
  const info = describe(listing);
  return (
    <ListingLink listing={listing} label={info.label} style={StyleSheet.flatten([styles.row, last && styles.rowLast])}>
      <View style={styles.rowInner}>
        <Photo listing={listing} style={styles.rowPhoto} />
        <View style={[styles.grow, styles.rowText]}>
          <AppText style={styles.rowPrice} numberOfLines={1}>{info.price ?? "Price on request"}</AppText>
          <AppText style={styles.title} numberOfLines={1}>{listing.title}</AppText>
          <Location text={info.location} />
          {info.facts ? <AppText style={styles.meta} numberOfLines={1}>{info.facts}</AppText> : null}
        </View>
        <SaveButton listing={listing} size={18} />
      </View>
    </ListingLink>
  );
});

/** A city tile: one real listing's photo and the city's name; opens Search for that city. */
export const CityTileCard = memo(function CityTileCard({ city, listing, onPress }: { city: string; listing: PublicListing; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Properties in ${city}`} onPress={onPress} style={styles.cityTile} testID={`city-${city.toLowerCase()}`}>
      {({ pressed }) => (
        <View style={[styles.fill, pressed && styles.pressed]}>
          <Photo listing={listing} style={styles.cityPhoto} />
          <View style={styles.cityLabel}>
            <AppText style={styles.cityName} numberOfLines={1}>{city}</AppText>
            <MaterialCommunityIcons name="arrow-right" size={16} color={colors.action} />
          </View>
        </View>
      )}
    </Pressable>
  );
});

const badge = { overflow: "hidden" as const, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2, fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.9 },
  grow: { flex: 1 },
  card: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  photo: { backgroundColor: colors.cream, overflow: "hidden" },
  noPhoto: { flex: 1, alignItems: "center", justifyContent: "center" },
  railPhoto: { aspectRatio: 4 / 3 },
  badges: { position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 6 },
  typeBadge: { ...badge, backgroundColor: colors.forestDeep, color: colors.white },
  lightBadge: { ...badge, backgroundColor: colors.elevated, color: colors.forestDeep },
  save: { position: "absolute", top: 6, right: 6 },
  saveSmall: { position: "absolute", top: 4, right: 4 },
  body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 2 },
  price: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.forestDeep },
  title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.ink },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  meta: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  featured: { borderRadius: radii.shell, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  featuredPhoto: { aspectRatio: 16 / 10 },
  featuredBody: { flexDirection: "row", alignItems: "flex-end", gap: 12, padding: 14 },
  featuredTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.forestDeep },
  featuredPrice: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.forestDeep, maxWidth: "45%" },
  gridPhoto: { aspectRatio: 1.15 },
  gridBody: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 1 },
  gridPrice: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.forestDeep },
  row: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowLast: { borderBottomWidth: 0 },
  rowInner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10 },
  rowPhoto: { width: 88, height: 72, borderRadius: radii.control },
  rowText: { gap: 1 },
  rowPrice: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.forestDeep },
  cityTile: { width: 132, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  cityPhoto: { height: 84 },
  cityLabel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  cityName: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.forestDeep },
});
