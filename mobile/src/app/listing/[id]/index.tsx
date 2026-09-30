import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/api/provider";
import { useListing } from "@/api/queries";
import type { PublicListing } from "@/api/types";
import { VerifiedBadge } from "@/components/listing-card";
import { QueryState } from "@/components/query-state";
import { SaveButton } from "@/components/save-button";
import { AppText, Button } from "@/components/ui";
import { formatFacts, formatListingPrice, formatLocation, humanise, isVerified, listingPhotos } from "@/marketplace/format";
import { stayLabel } from "@/marketplace/listing-categories";
import { colors, radii, spacing } from "@/theme/tokens";

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useListing(id);
  const listing = query.data?.listing;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: listing
            ? () => (
                <View style={styles.headerActions}>
                  <Pressable
                    accessibilityLabel="Share property"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => shareListing(listing)}
                    style={styles.headerShare}
                    testID="share-property"
                  >
                    <Ionicons name="share-outline" size={23} color={colors.ink} />
                  </Pressable>
                  <SaveButton listing={listing} />
                </View>
              )
            : undefined,
        }}
      />
      {!listing ? <QueryState isPending={query.isPending} error={query.error} onRetry={() => query.refetch()} /> : <ListingDetail listing={listing} />}
    </View>
  );
}

async function shareListing(listing: PublicListing) {
  const url = `https://www.nesafric.com/marketplace/properties/${listing.id}`;

  await Share.share({
    title: listing.title,
    message: `${listing.title}\n${url}`,
    url,
  });
}

function ListingDetail({ listing }: { listing: PublicListing }) {
  const insets = useSafeAreaInsets();
  const price = formatListingPrice(listing);
  const location = formatLocation(listing.location);
  const facts = formatFacts(listing.attributes);
  const canContact = listing.contact.enquiryEnabled;
  // Hotels and short stays: the main action is a booking request, not an enquiry.
  const bookable = listing.bookable === true;
  const hasActions = bookable || canContact;
  const kind = stayLabel(listing.category);
  // Public locations are deliberately approximate (APPROXIMATE / DISTRICT / CITY / REGION).
  const approximate = Boolean(listing.location.map.precision);

  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: hasActions ? 120 + insets.bottom : spacing.xxl }}>
        <Gallery listing={listing} />
        <View style={styles.body}>
          <View style={styles.titleBlock}>
            <AppText variant="title">{price ?? "Price on request"}</AppText>
            <AppText variant="heading">{listing.title}</AppText>
            {location ? (
              <View style={styles.inline}>
                <Ionicons name="location-outline" size={16} color={colors.muted} />
                <AppText variant="caption">
                  {location}
                  {approximate ? " (approximate area)" : ""}
                </AppText>
              </View>
            ) : null}
            {isVerified(listing) ? <VerifiedBadge label="Verified property" /> : null}
          </View>

          {facts ? (
            <View style={styles.facts}>
              <AppText variant="label">{facts}</AppText>
            </View>
          ) : null}

          <Section title="Key facts">
            <Fact label="Listing" value={kind ?? (listing.listingType === "RENT" ? "For rent" : "For sale")} />
            <Fact label="Property type" value={humanise(listing.category)} />
            {listing.availability.availableFrom ? <Fact label="Available from" value={formatDate(listing.availability.availableFrom)} /> : null}
            <Fact label="Listed by" value={listing.attribution.professional ? `${listing.attribution.professional.displayName} (${listing.attribution.listedBy})` : listing.attribution.listedBy} />
          </Section>

          {bookable && listing.stay ? (
            <Section title="Stay details">
              {listing.stay.maxGuests ? <Fact label="Guests" value={`Up to ${listing.stay.maxGuests}`} /> : null}
              {listing.stay.minimumNights && listing.stay.minimumNights > 1 ? <Fact label="Minimum stay" value={`${listing.stay.minimumNights} nights`} /> : null}
              {listing.stay.checkInTime ? <Fact label="Check-in" value={`From ${listing.stay.checkInTime}`} /> : null}
              {listing.stay.checkOutTime ? <Fact label="Check-out" value={`By ${listing.stay.checkOutTime}`} /> : null}
              {listing.stay.houseRules ? <AppText variant="caption">{listing.stay.houseRules}</AppText> : null}
            </Section>
          ) : null}

          {listing.description ? (
            <Section title="About this property">
              <AppText>{listing.description}</AppText>
            </Section>
          ) : null}

          {listing.amenities.length ? (
            <Section title="Amenities">
              <View style={styles.amenities}>
                {listing.amenities.map((amenity) => (
                  <View key={amenity.key} style={styles.amenity}>
                    <AppText style={styles.amenityText}>{amenity.label}</AppText>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {!hasActions ? <AppText variant="caption">The lister isn’t taking enquiries through NesAfric for this property right now.</AppText> : null}
        </View>
      </ScrollView>

      {bookable ? (
        <View style={[styles.actions, { paddingBottom: spacing.md + insets.bottom }]}>
          {canContact ? (
            <View style={styles.action}>
              <Button
                label="Contact property"
                variant="secondary"
                onPress={() => router.push({ pathname: "/listing/[id]/enquire", params: { id: listing.id, mode: "contact" } })}
                testID="contact-property"
              />
            </View>
          ) : null}
          <View style={styles.action}>
            <Button label="Request booking" onPress={() => router.push({ pathname: "/listing/[id]/book", params: { id: listing.id } })} testID="request-booking" />
          </View>
        </View>
      ) : canContact ? (
        <View style={[styles.actions, { paddingBottom: spacing.md + insets.bottom }]}>
          <View style={styles.action}>
            <Button
              label="Contact agent"
              variant="secondary"
              onPress={() => router.push({ pathname: "/listing/[id]/enquire", params: { id: listing.id, mode: "contact" } })}
              testID="contact-agent"
            />
          </View>
          <View style={styles.action}>
            <Button
              label="Schedule viewing"
              onPress={() => router.push({ pathname: "/listing/[id]/enquire", params: { id: listing.id, mode: "viewing" } })}
              testID="schedule-viewing"
            />
          </View>
        </View>
      ) : null}
    </>
  );
}

function Gallery({ listing }: { listing: PublicListing }) {
  const { apiUrl } = useApi();
  const { width } = useWindowDimensions();
  const photos = listingPhotos(listing.media, apiUrl);
  const [index, setIndex] = useState(0);
  const height = Math.round(width * 0.75);

  if (!photos.length) {
    return (
      <View style={[styles.noPhoto, { height: height * 0.6 }]}>
        <Ionicons name="image-outline" size={32} color={colors.muted} />
        <AppText variant="caption">No photos yet</AppText>
      </View>
    );
  }
  return (
    <View>
      <FlatList
        horizontal
        pagingEnabled
        data={photos}
        keyExtractor={(photo) => photo.id}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <Image source={{ uri: item.url }} style={{ width, height }} contentFit="cover" transition={150} cachePolicy="memory-disk" accessibilityLabel={item.altText ?? listing.title} />
        )}
        initialNumToRender={1}
        windowSize={3}
      />
      {photos.length > 1 ? (
        <View style={styles.counter}>
          <AppText style={styles.counterText}>
            {index + 1} / {photos.length}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="heading">{title}</AppText>
      {children}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="label" style={styles.factValue}>
        {value}
      </AppText>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (date.getTime() <= Date.now()) return "Now";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerShare: { alignItems: "center", justifyContent: "center", minWidth: 32, minHeight: 32 },
  body: { padding: spacing.xl, gap: spacing.xl },
  titleBlock: { gap: spacing.xs },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  facts: { paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hairline },
  section: { gap: spacing.sm },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 6 },
  factValue: { flexShrink: 1, textAlign: "right" },
  amenities: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  amenity: { borderRadius: radii.pill, backgroundColor: colors.cream, paddingHorizontal: spacing.md, paddingVertical: 6 },
  amenityText: { fontSize: 14, lineHeight: 18 },
  noPhoto: { alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.cream },
  counter: { position: "absolute", right: spacing.md, bottom: spacing.md, backgroundColor: "rgba(16,45,42,0.75)", borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  counterText: { color: colors.white, fontSize: 12, lineHeight: 16 },
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.elevated,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  action: { flex: 1 },
});
