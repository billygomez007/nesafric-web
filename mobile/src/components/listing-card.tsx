import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { useApi } from "@/api/provider";
import type { PublicListing } from "@/api/types";
import { formatFacts, formatListingPrice, formatLocation, isVerified, listingPhotos } from "@/marketplace/format";
import { colors, radii, spacing } from "@/theme/tokens";
import { SaveButton } from "./save-button";
import { AppText } from "./ui";

/**
 * Marketplace card: photo, price, title, location, key facts, verified badge, save.
 * Deliberately nothing operational (brief §4).
 */
export function ListingCard({ listing, variant = "full" }: { listing: PublicListing; variant?: "full" | "compact" }) {
  const { apiUrl } = useApi();
  const photo = listingPhotos(listing.media, apiUrl)[0];
  const price = formatListingPrice(listing);
  const location = formatLocation(listing.location);
  const facts = formatFacts(listing.attributes);
  const compact = variant === "compact";
  const isRent = listing.listingType === "RENT";
  const isLand = listing.category === "LAND";
  const isCommercial = listing.category === "COMMERCIAL";

  const card = (
    <Link href={{ pathname: "/listing/[id]", params: { id: listing.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[price, listing.title, location].filter(Boolean).join(", ")}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={[styles.photoWrap, compact && styles.photoCompact]}>
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
              <Ionicons name="image-outline" size={28} color={colors.muted} />
              <AppText variant="caption">No photos yet</AppText>
            </View>
          )}
          <View style={styles.photoBadges}>
            <View style={[styles.listingBadge, isRent ? styles.rentBadge : styles.saleBadge]}>
              <AppText style={[styles.listingBadgeText, isRent ? styles.rentBadgeText : styles.saleBadgeText]}>
                {isRent ? "For rent" : "For sale"}
              </AppText>
            </View>

            {isLand ? (
              <View style={[styles.listingBadge, styles.landBadge]}>
                <AppText style={[styles.listingBadgeText, styles.landBadgeText]}>Land</AppText>
              </View>
            ) : null}

            {isCommercial ? (
              <View style={[styles.listingBadge, styles.commercialBadge]}>
                <AppText style={[styles.listingBadgeText, styles.commercialBadgeText]}>Commercial</AppText>
              </View>
            ) : null}
          </View>

          <View style={styles.saveSlot}>
            <SaveButton listing={listing} />
          </View>
        </View>
        <View style={styles.body}>
          {price ? <AppText variant="heading">{price}</AppText> : <AppText variant="label">Price on request</AppText>}
          <AppText variant="label" numberOfLines={1}>
            {listing.title}
          </AppText>
          {location ? (
            <AppText variant="caption" numberOfLines={1}>
              {location}
            </AppText>
          ) : null}
          <View style={styles.footer}>
            {facts ? (
              <AppText variant="caption" numberOfLines={1} style={styles.facts}>
                {facts}
              </AppText>
            ) : (
              <View style={styles.facts} />
            )}
            {isVerified(listing) ? <VerifiedBadge /> : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
  // Fixed-width wrapper so horizontal shelves don't size cards to their title length.
  return compact ? <View style={styles.compact}>{card}</View> : card;
}

export function VerifiedBadge({ label = "Verified" }: { label?: string }) {
  return (
    <View style={styles.badge} accessibilityLabel={label}>
      <Ionicons name="checkmark-circle" size={14} color={colors.marketVerified} />
      <AppText style={styles.badgeText}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.elevated,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  compact: { width: 260 },
  pressed: { opacity: 0.92 },
  photoWrap: { aspectRatio: 4 / 3, backgroundColor: colors.cream },
  photoCompact: { aspectRatio: 16 / 11 },
  noPhoto: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  photoBadges: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    right: 52,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  listingBadge: {
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  listingBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: "NotoSans-Bold",
  },
  rentBadge: {
    backgroundColor: colors.marketRentTint,
    borderColor: colors.marketRent,
  },
  rentBadgeText: {
    color: colors.marketRent,
  },
  saleBadge: {
    backgroundColor: colors.marketSaleTint,
    borderColor: colors.marketSale,
  },
  saleBadgeText: {
    color: colors.marketSale,
  },
  landBadge: {
    backgroundColor: colors.marketLandTint,
    borderColor: colors.marketLand,
  },
  landBadgeText: {
    color: colors.marketLand,
  },
  commercialBadge: {
    backgroundColor: colors.marketCommercialTint,
    borderColor: colors.marketCommercial,
  },
  commercialBadgeText: {
    color: colors.marketCommercial,
  },
  saveSlot: { position: "absolute", top: spacing.sm, right: spacing.sm },
  body: { padding: spacing.md, gap: 2 },
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  facts: { flex: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.marketVerified,
    backgroundColor: colors.marketVerifiedTint,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.marketVerified,
    fontFamily: "NotoSans-Bold",
  },
});
