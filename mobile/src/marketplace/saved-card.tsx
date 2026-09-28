import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiError } from "@/api/client";
import { useApi } from "@/api/provider";
import { useListing } from "@/api/queries";
import type { PublicListing } from "@/api/types";
import { VerifiedBadge } from "@/components/listing-card";
import { SaveButton } from "@/components/save-button";
import { AppText, Button } from "@/components/ui";
import { formatFacts, formatListingPrice, formatLocation, isVerified, listingPhotos } from "@/marketplace/format";
import { useSaved, type SavedListing } from "@/marketplace/saved";
import { colors, radii, spacing } from "@/theme/tokens";

/**
 * One saved property. It reads the listing through the same `["listing", id]` query as the detail
 * screen, so both always agree; the saved snapshot is shown while that loads or when offline, and
 * is updated whenever newer public data arrives. Only rows the list actually renders fetch, which
 * keeps requests well inside the public listing rate limit.
 */
export function SavedListingCard({ saved }: { saved: SavedListing }) {
  const query = useListing(saved.listing.id);
  const { refreshSnapshot } = useSaved();
  const fresh = query.data?.listing;

  useEffect(() => {
    if (fresh) refreshSnapshot(fresh);
  }, [fresh, refreshSnapshot]);

  // The public API answers 404 once a listing is unpublished, unverified, let or withdrawn.
  if (query.error instanceof ApiError && query.error.status === 404) return <UnavailableRow saved={saved} />;
  return <AvailableCard listing={fresh ?? saved.listing} savedAt={saved.savedAt} />;
}

function AvailableCard({ listing, savedAt }: { listing: PublicListing; savedAt: string }) {
  const { apiUrl } = useApi();
  const photo = listingPhotos(listing.media, apiUrl)[0];
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const price = formatListingPrice(listing);
  const location = formatLocation(listing.location);
  const facts = formatFacts(listing.attributes);
  const savedOn = formatSavedDate(savedAt);

  return (
    <Link href={{ pathname: "/listing/[id]", params: { id: listing.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[price ?? "Price on request", listing.title, location, facts, isVerified(listing) ? "Verified" : null].filter(Boolean).join(", ")}
        accessibilityHint="Opens the property details"
        // Expo Router's `Link asChild` spreads the child's style into an object, which silently
        // drops a style *function* (the card lost its surface, border and radius). Keep the card
        // style a flat object and apply press feedback inside.
        style={StyleSheet.flatten(styles.card)}
        testID={`saved-card-${listing.id}`}
      >
        {({ pressed }) => (
          <View style={pressed && styles.pressed}>
            <View style={styles.photoWrap}>
              {photo && failedUrl !== photo.url ? (
                <Image
                  source={{ uri: photo.url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={listing.id}
                  accessibilityLabel={photo.altText ?? listing.title}
                  onError={() => setFailedUrl(photo.url)}
                  testID={`saved-photo-${listing.id}`}
                />
              ) : (
                <View style={styles.noPhoto} testID={`saved-no-photo-${listing.id}`}>
                  <Ionicons name="image-outline" size={28} color={colors.muted} />
                  <AppText variant="caption">{photo ? "Photo unavailable" : "No photos yet"}</AppText>
                </View>
              )}
              <View style={styles.saveSlot}>
                <SaveButton listing={listing} />
              </View>
            </View>
            <View style={styles.body}>
              {price ? <AppText variant="heading">{price}</AppText> : <AppText variant="label">Price on request</AppText>}
              <AppText variant="label" numberOfLines={2}>
                {listing.title}
              </AppText>
              {location ? (
                <View style={styles.inline}>
                  <Ionicons name="location-outline" size={14} color={colors.muted} />
                  <AppText variant="caption" numberOfLines={1} style={styles.flex}>
                    {location}
                  </AppText>
                </View>
              ) : null}
              <View style={styles.footer}>
                {facts ? (
                  <AppText variant="caption" numberOfLines={1} style={styles.flex}>
                    {facts}
                  </AppText>
                ) : (
                  <View style={styles.flex} />
                )}
                {isVerified(listing) ? <VerifiedBadge /> : null}
              </View>
              {savedOn ? (
                <AppText variant="caption" style={styles.savedOn}>
                  Saved {savedOn}
                </AppText>
              ) : null}
            </View>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

/** A saved listing the marketplace no longer shows: only what the user saved, plus a way to remove it. */
function UnavailableRow({ saved }: { saved: SavedListing }) {
  const { remove } = useSaved();
  return (
    <View style={[styles.card, styles.unavailable]} testID={`saved-unavailable-${saved.listing.id}`}>
      <View style={styles.inline}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.muted} />
        <AppText variant="label" style={styles.flex}>
          No longer available
        </AppText>
      </View>
      <AppText variant="caption" numberOfLines={2}>
        “{saved.listing.title}” has been let, sold or taken down, so it no longer appears on NesAfric.
      </AppText>
      <Button label="Remove from saved" variant="secondary" onPress={() => remove(saved.listing.id)} testID={`saved-remove-${saved.listing.id}`} />
    </View>
  );
}

function formatSavedDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.elevated,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  pressed: { opacity: 0.92 },
  photoWrap: { aspectRatio: 16 / 10, backgroundColor: colors.cream },
  noPhoto: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  // SaveButton is 36pt; its 8pt hitSlop gives a 52pt touch target.
  saveSlot: { position: "absolute", top: spacing.sm, right: spacing.sm },
  body: { padding: spacing.md, gap: 2 },
  inline: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  savedOn: { marginTop: spacing.xs },
  unavailable: { padding: spacing.lg, gap: spacing.sm },
});
