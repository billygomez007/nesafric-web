import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { websiteUrl } from "@/config";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useApi } from "@/api/provider";
import { AppText, Button, Loading, Notice, StateMessage } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

/** Shared loading / error / refresh frame for the read-only enquiry and viewing details. */
export function DetailFrame({ query, noun, webPath, children }: { query: { data: unknown; isPending: boolean; isRefetching: boolean; error: unknown; refetch: () => unknown }; noun: string; webPath: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { apiUrl } = useApi();
  const { error } = query;

  // A refusal or "not found" from the server always wins, even over a row shown from the list.
  const refused = error instanceof ApiError && (error.status === 403 || error.status === 404);
  if (query.isPending && !query.data && !error) return <Loading />;
  if (!query.data || refused) {
    if (error instanceof ApiError && error.status === 404) {
      return <StateMessage title={`This ${noun} isn’t available`} message="It may have been removed, or it belongs to another workspace." />;
    }
    if (error instanceof ApiError && error.status === 403) {
      return <StateMessage title="Your role here doesn’t include this" message="Ask an owner or administrator of this workspace if you need access." />;
    }
    const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
    return (
      <StateMessage
        title={offline ? "You’re offline" : `Couldn’t load this ${noun}`}
        message={offline ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again."}
        actionLabel="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.brand} />}
    >
      {error ? <Notice tone="warning" message="Couldn’t refresh this. Showing what was already loaded; pull down to try again." /> : null}
      {children}
      <View style={styles.footer}>
        <AppText variant="caption" style={styles.center}>
          This is a read-only view. To reply, assign or update the status, use nesafric.com.
        </AppText>
        <Button label="Open on nesafric.com" variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `${webPath}`))} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  footer: { gap: spacing.sm, marginTop: spacing.sm },
  center: { textAlign: "center" },
});
