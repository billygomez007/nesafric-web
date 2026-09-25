import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import type { EnquirySummary, Page, ViewingSummary } from "@/api/inbox";
import { useEnquiryList, useInboxAccess, useViewingList, type InboxKind } from "@/api/inbox-queries";
import { Chip } from "@/components/chip";
import { AppText, Button, Loading, StateMessage } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import { formatDateTime, StatusPill, useWorkspaceGate, viewingWhen } from "@/workspace/inbox-ui";
import { enquiryRoute, viewingRoute, type InboxScope } from "@/workspace/scope";

const LABELS: Record<InboxKind, string> = { enquiries: "Enquiries", viewings: "Viewings" };

/**
 * Read-only inbox for one workspace (organisation or agent). Tabs appear only for sections the
 * server lets this person read; every call is scoped to this workspace and re-checked by the server.
 */
export function InboxScreen({ kind, id, tab: initialTab }: { kind: InboxScope["kind"]; id: string | undefined; tab?: string }) {
  const { gate, scope } = useWorkspaceGate(kind, id);
  const access = useInboxAccess(scope);
  const [chosen, setChosen] = useState<InboxKind | null>(initialTab === "viewings" || initialTab === "enquiries" ? initialTab : null);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  const states = { enquiries: access.enquiries, viewings: access.viewings };
  if (states.enquiries.state === "loading" || states.viewings.state === "loading") return <Loading />;
  const failed = [states.enquiries, states.viewings].find((state) => state.state === "error");
  if (failed && failed.state === "error") return <ListError error={failed.error} onRetry={() => void access.retry()} />;

  const tabs = (["enquiries", "viewings"] as const).filter((kind) => states[kind].state === "allowed");
  if (tabs.length === 0) {
    return (
      <View style={styles.screen}>
        <StateMessage title="Your role here doesn’t include enquiries or viewings" message="Ask an owner or administrator of this workspace if you need access." />
      </View>
    );
  }
  const tab = chosen && tabs.includes(chosen) ? chosen : tabs[0];

  return (
    <View style={styles.screen}>
      {tabs.length > 1 ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((kind) => (
            <Chip key={kind} label={LABELS[kind]} selected={kind === tab} onPress={() => setChosen(kind)} />
          ))}
        </View>
      ) : null}
      {tab === "enquiries" ? <EnquiryList scope={scope!} /> : <ViewingList scope={scope!} />}
    </View>
  );
}

function EnquiryList({ scope }: { scope: InboxScope }) {
  const list = useEnquiryList(scope);
  return (
    <InboxList
      list={list}
      empty="No enquiries yet. They appear here when someone contacts you about one of your listings."
      renderRow={(item: EnquirySummary) => (
        <Row
          testID={`enquiry-${item.id}`}
          title={item.name}
          subtitle={item.listing.title}
          meta={`Received ${formatDateTime(item.createdAt) ?? ""}`}
          status={item.status}
          onPress={() => router.push(enquiryRoute(scope, item.id))}
        />
      )}
    />
  );
}

function ViewingList({ scope }: { scope: InboxScope }) {
  const list = useViewingList(scope);
  return (
    <InboxList
      list={list}
      empty="No viewing requests yet. They appear here when someone asks to see one of your listings."
      renderRow={(item: ViewingSummary) => (
        <Row
          testID={`viewing-${item.id}`}
          title={item.lead.name}
          subtitle={item.listing.title}
          meta={viewingWhen(item)}
          status={item.status}
          onPress={() => router.push(viewingRoute(scope, item.id))}
        />
      )}
    />
  );
}

type ListQuery<T> = UseInfiniteQueryResult<InfiniteData<Page<T>>>;

function InboxList<T extends { id: string }>({ list, empty, renderRow }: { list: ListQuery<T>; empty: string; renderRow: (item: T) => ReactElement }) {
  const insets = useSafeAreaInsets();
  if (list.isPending) return <Loading />;
  if (!list.data) return <ListError error={list.error} onRetry={() => void list.refetch()} />;
  const items = list.data.pages.flatMap((page) => page.items);
  const total = list.data.pages[0]?.pagination.total ?? items.length;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderRow(item)}
      contentContainerStyle={[styles.listContent, { paddingBottom: spacing.xxl + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={colors.brand} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
      }}
      ListHeaderComponent={items.length ? <AppText variant="caption" style={styles.count}>{`Showing ${items.length} of ${total}`}</AppText> : null}
      ListEmptyComponent={<StateMessage title="Nothing here yet" message={empty} />}
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <View style={styles.footer} accessibilityLabel="Loading more">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : list.isFetchNextPageError ? (
          <View style={styles.footer}>
            <AppText variant="caption">Couldn’t load more.</AppText>
            <Button label="Try again" variant="secondary" onPress={() => void list.fetchNextPage()} testID="load-more-retry" />
          </View>
        ) : list.hasNextPage ? (
          <View style={styles.footer}>
            <Button label="Load more" variant="secondary" onPress={() => void list.fetchNextPage()} testID="load-more" />
          </View>
        ) : items.length ? (
          <AppText variant="caption" style={styles.end}>
            That’s everything.
          </AppText>
        ) : null
      }
    />
  );
}

function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return <StateMessage title="Your role here doesn’t include this" message="Ask an owner or administrator of this workspace if you need access." />;
  }
  const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
  return (
    <StateMessage
      title={offline ? "You’re offline" : "Couldn’t load the inbox"}
      message={offline ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again."}
      actionLabel="Try again"
      onAction={onRetry}
    />
  );
}

function Row({ title, subtitle, meta, status, onPress, testID }: { title: string; subtitle: string; meta: string; status: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}, ${meta}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTop}>
        <AppText variant="label" numberOfLines={1} style={styles.flex}>
          {title}
        </AppText>
        <StatusPill status={status} />
      </View>
      <AppText numberOfLines={1}>{subtitle}</AppText>
      <AppText variant="caption">{meta}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  listContent: { padding: spacing.xl, gap: spacing.sm, flexGrow: 1 },
  count: { marginBottom: spacing.xs },
  row: { backgroundColor: colors.elevated, borderRadius: 14, borderWidth: 1, borderColor: colors.hairline, padding: spacing.lg, gap: 2 },
  rowPressed: { backgroundColor: colors.surface },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  footer: { paddingVertical: spacing.lg, alignItems: "center", gap: spacing.sm },
  end: { textAlign: "center", paddingVertical: spacing.lg },
});
