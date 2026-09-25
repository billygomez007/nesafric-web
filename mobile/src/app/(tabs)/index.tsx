import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useListingCollection } from "@/api/queries";
import { Chip } from "@/components/chip";
import { ListingCard } from "@/components/listing-card";
import { AppText, Loading, StateMessage } from "@/components/ui";
import { INTENTS, PROPERTY_TYPES, type SearchFilters } from "@/marketplace/filters";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

/**
 * Collections backed by real public-listing queries. Collections that need backend support the API
 * doesn't have yet (Featured, Near You, New Developments) are not shown; every public listing is
 * already verified, so "Verified" is the default rather than a separate shelf.
 */
const COLLECTIONS: { key: string; title: string; filters: SearchFilters }[] = [
  { key: "newest", title: "Newly listed", filters: {} },
  { key: "rent", title: "For rent", filters: { listingType: "RENT" } },
  { key: "sale", title: "For sale", filters: { listingType: "SALE" } },
  { key: "accra", title: "Popular in Accra", filters: { city: "Accra" } },
  { key: "land", title: "Land opportunities", filters: { category: "LAND" } },
  { key: "commercial", title: "Commercial properties", filters: { category: "COMMERCIAL" } },
];

export default function HomeScreen() {
  const [q, setQ] = useState("");
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const newest = useListingCollection("newest", {});

  async function refresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["collection"] });
    setRefreshing(false);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <View style={styles.topBar}>
          <Image source={require("../../../assets/images/nesafric-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="NesAfric" />
          <Pressable accessibilityRole="button" accessibilityLabel="Account" hitSlop={8} onPress={() => router.navigate("/account")}>
            <Ionicons name="person-circle-outline" size={32} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <AppText variant="title" style={styles.heroTitle}>
            Find your perfect property
          </AppText>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={20} color={colors.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Area, city or property"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              accessibilityLabel="Search by area, city or property"
              onSubmitEditing={() => openSearch({ q: q.trim() })}
              style={styles.searchInput}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {INTENTS.map((intent) => (
              <Chip key={intent.label} label={intent.label} onPress={() => openSearch(intent.filters)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {PROPERTY_TYPES.filter((type) => !["LAND", "COMMERCIAL"].includes(type.value)).map((type) => (
              <Chip key={type.value} label={type.label} onPress={() => openSearch({ category: type.value })} />
            ))}
          </ScrollView>
        </View>

        {newest.isPending ? (
          <Loading />
        ) : newest.error ? (
          <StateMessage
            title={newest.error instanceof ApiError && newest.error.code === NETWORK_ERROR ? "You're offline" : "Couldn't load properties"}
            message={newest.error.message}
            actionLabel="Try again"
            onAction={() => newest.refetch()}
          />
        ) : newest.data.items.length === 0 ? (
          <StateMessage title="No properties listed yet" message="Verified properties will appear here as soon as they're published." />
        ) : (
          COLLECTIONS.map((collection) => <Collection key={collection.key} id={collection.key} title={collection.title} filters={collection.filters} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Collection({ id, title, filters }: { id: string; title: string; filters: SearchFilters }) {
  // Same query key as the "newest" probe above, so that shelf reuses its response.
  const query = useListingCollection(id, filters);
  // Only real data: an empty or failed shelf is simply not shown on Home.
  if (!query.data || query.data.items.length === 0) return null;
  return (
    <View style={styles.collection}>
      <View style={styles.collectionHeader}>
        <AppText variant="heading">{title}</AppText>
        <Pressable accessibilityRole="link" onPress={() => openSearch(filters)} hitSlop={8}>
          <AppText style={styles.seeAll}>See all</AppText>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={query.data.items}
        keyExtractor={(listing) => listing.id}
        renderItem={({ item }) => <ListingCard listing={item} variant="compact" />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.collectionList}
        initialNumToRender={2}
        windowSize={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxl, gap: spacing.xl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  logo: { width: 132, height: 44 },
  hero: { gap: spacing.md },
  heroTitle: { paddingHorizontal: spacing.xl },
  searchBox: {
    marginHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, paddingVertical: spacing.sm },
  chips: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  collection: { gap: spacing.md },
  collectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl },
  seeAll: { fontFamily: fonts.bold, color: colors.brandStrong },
  collectionList: { paddingHorizontal: spacing.xl, gap: spacing.md },
});
