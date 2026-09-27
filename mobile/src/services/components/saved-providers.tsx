import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { useSavedProviders, useToggleSavedProvider } from "@/api/service-queries";
import type { SavedProviderItem } from "@/api/types";
import { useSession } from "@/auth/session";
import { QueryState } from "@/components/query-state";
import { AppText, Button, Card, Loading, Notice } from "@/components/ui";
import { openProviderSearch } from "@/services/navigation";
import { colors, spacing } from "@/theme/tokens";
import { ProviderCard } from "./provider-card";

/**
 * Saved service providers, from the signed-in account (not this device). Available providers use
 * the shared provider card; one that has left the marketplace is shown only as "no longer listed"
 * — the server sends no details for it — with a way to remove it.
 */
export function SavedProviders() {
  const { status } = useSession();
  const saved = useSavedProviders();
  const items = saved.data?.items ?? [];

  if (status === "restoring") return <Loading />;
  if (status === "signedOut") {
    return (
      <View style={styles.pad}>
      <Card style={styles.empty} testID="saved-providers-signed-out">
        <Icon />
        <AppText variant="heading" style={styles.center} accessibilityRole="header">Save providers to your account</AppText>
        <AppText variant="caption" style={styles.center}>
          Sign in to keep trusted plumbers, electricians and other professionals here, on any device.
        </AppText>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} testID="saved-providers-sign-in" />
      </Card>
      </View>
    );
  }
  if (!saved.data) return <QueryState isPending={saved.isPending} error={saved.error} onRetry={() => saved.refetch()} />;

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header">Saved providers</AppText>
        <AppText variant="caption">
          {items.length ? `${items.length} ${items.length === 1 ? "provider" : "providers"} · ` : ""}Saved to your NesAfric account.
        </AppText>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.providerId}
        renderItem={({ item }) => (item.available ? <ProviderCard provider={item.provider} /> : <UnavailableProvider item={item} />)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={saved.isRefetching} onRefresh={() => saved.refetch()} tintColor={colors.brand} />}
        ListEmptyComponent={
          <Card style={styles.empty} testID="saved-providers-empty">
            <Icon />
            <AppText variant="heading" style={styles.center} accessibilityRole="header">No saved providers yet</AppText>
            <AppText variant="caption" style={styles.center}>Tap the heart on any service provider to keep them here.</AppText>
            <Button label="Browse service providers" onPress={() => openProviderSearch()} />
          </Card>
        }
        testID="saved-providers-list"
      />
    </View>
  );
}

function UnavailableProvider({ item }: { item: Extract<SavedProviderItem, { available: false }> }) {
  const toggle = useToggleSavedProvider();
  return (
    <Card testID={`saved-provider-unavailable-${item.providerId}`}>
      <AppText variant="label">No longer listed</AppText>
      <AppText variant="caption">This provider isn’t on the NesAfric marketplace right now, so their details aren’t shown.</AppText>
      {toggle.isError ? <Notice message="Couldn’t remove it. Please try again." /> : null}
      <Button label="Remove" variant="secondary" loading={toggle.isPending} onPress={() => toggle.mutate({ provider: { id: item.providerId }, save: false })} />
    </Card>
  );
}

function Icon() {
  return (
    <View style={styles.emptyIcon} accessibilityElementsHidden importantForAccessibility="no">
      <Ionicons name="heart-outline" size={30} color={colors.gold} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: spacing.xl },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.xs },
  list: { padding: spacing.xl, paddingTop: spacing.md, gap: spacing.lg, flexGrow: 1 },
  empty: { alignItems: "stretch", gap: spacing.md, padding: spacing.xl, marginTop: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.gold },
  emptyIcon: { alignSelf: "center", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
});
