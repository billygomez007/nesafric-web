import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { MarketplaceModeSwitch } from "@/components/marketplace-mode-switch";
import { AppText, Button, Card, Loading, Notice } from "@/components/ui";
import type { MarketplaceMode } from "@/marketplace/mode";
import { openSearch } from "@/marketplace/navigation";
import { useSaved } from "@/marketplace/saved";
import { SavedListingCard } from "@/marketplace/saved-card";
import { SavedProviders } from "@/services/components/saved-providers";
import { colors, spacing } from "@/theme/tokens";

/**
 * Saved, in two sections matching the marketplace selector: Properties (the default) and Service
 * Providers. The choice here is local to Saved and doesn't move Home or Search.
 */
export default function SavedScreen() {
  const [section, setSection] = useState<MarketplaceMode>("properties");
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <MarketplaceModeSwitch value={section} onChange={setSection} label="Saved" testIDPrefix="saved-section" style={styles.switch} />
      {section === "services" ? <SavedProviders /> : <SavedProperties />}
    </SafeAreaView>
  );
}

/**
 * Saved properties. Works without an account (saves live on this device; there is no server-side
 * favourites API yet). Each card re-checks its listing with the public API, so prices stay current
 * and listings that have left the marketplace are shown as no longer available.
 */
function SavedProperties() {
  const { ready, items, error, dismissError } = useSaved();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  async function refresh() {
    setRefreshing(true);
    const ids = new Set(items.map((item) => item.listing.id));
    const isSavedListing = (key: readonly unknown[]) => key[0] === "listing" && ids.has(String(key[1]));
    try {
      await queryClient.refetchQueries({ predicate: (query) => isSavedListing(query.queryKey), type: "active" });
    } finally {
      const failedOffline = queryClient
        .getQueryCache()
        .findAll({ predicate: (query) => isSavedListing(query.queryKey), type: "active" })
        .some((query) => query.state.error instanceof ApiError && query.state.error.code === NETWORK_ERROR);
      setOffline(failedOffline);
      setRefreshing(false);
    }
  }

  const count = items.length;

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header">
          Saved properties
        </AppText>
        <AppText variant="caption">
          {count ? `${count} ${count === 1 ? "property" : "properties"} · ` : ""}Kept on this device — no account needed.
        </AppText>
      </View>
      {error ? (
        <View style={styles.notice}>
          <Notice message={error} />
          <Button label="Dismiss" variant="secondary" onPress={dismissError} testID="saved-dismiss-error" />
        </View>
      ) : null}
      {offline && count ? (
        <View style={styles.notice}>
          <Notice tone="warning" message="You’re offline. Showing the details saved on this device; pull down to try again." />
        </View>
      ) : null}
      {!ready ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.listing.id}
          renderItem={({ item }) => <SavedListingCard saved={item} />}
          contentContainerStyle={styles.list}
          initialNumToRender={6}
          windowSize={7}
          refreshControl={count ? <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.brand} /> : undefined}
          ListEmptyComponent={<EmptySaved />}
          testID="saved-list"
        />
      )}
    </View>
  );
}

function EmptySaved() {
  return (
    <Card style={styles.empty} testID="saved-empty">
      <View style={styles.emptyIcon} accessibilityElementsHidden importantForAccessibility="no">
        <Ionicons name="heart-outline" size={30} color={colors.gold} />
      </View>
      <AppText variant="heading" style={styles.center} accessibilityRole="header">
        Save properties you love
      </AppText>
      <AppText variant="caption" style={styles.center}>
        Tap the heart on any property to keep it here, so you can compare homes and come back to them later — even offline.
      </AppText>
      <Button label="Explore properties" onPress={() => openSearch({})} testID="saved-explore" />
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  switch: { marginHorizontal: spacing.xl, marginTop: spacing.sm },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.xs },
  notice: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  list: { padding: spacing.xl, paddingTop: spacing.md, gap: spacing.lg, flexGrow: 1 },
  empty: { alignItems: "stretch", gap: spacing.md, padding: spacing.xl, marginTop: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.gold },
  emptyIcon: { alignSelf: "center", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
});
