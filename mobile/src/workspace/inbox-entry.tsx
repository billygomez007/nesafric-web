import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import type { SectionAccess } from "@/api/inbox-queries";
import { AppText, Button, Card } from "@/components/ui";
import { colors, radii, spacing } from "@/theme/tokens";
import { inboxRoute, type InboxScope } from "./scope";

/**
 * "Enquiries & viewings", one row per section the server lets this person read (with the server's
 * own total). Hidden entirely when both are refused; independent of the property dashboard.
 */
export function InboxEntry({ scope, access }: { scope: InboxScope; access: { enquiries: SectionAccess; viewings: SectionAccess; retry: () => Promise<unknown> } }) {
  const { enquiries, viewings } = access;
  const onRetry = () => void access.retry();
  const sections = [
    { kind: "enquiries" as const, access: enquiries, label: "Enquiries", icon: "chatbubbles-outline" as const, noun: ["enquiry", "enquiries"] },
    { kind: "viewings" as const, access: viewings, label: "Viewing requests", icon: "calendar-outline" as const, noun: ["viewing request", "viewing requests"] },
  ];
  if (sections.every((section) => section.access.state === "denied")) return null;
  const loading = sections.some((section) => section.access.state === "loading");
  const failed = sections.find((section) => section.access.state === "error");
  const allowed = sections.filter((section) => section.access.state === "allowed");

  return (
    <View style={styles.inbox} testID="inbox-entry">
      <AppText variant="heading" accessibilityRole="header">
        Enquiries & viewings
      </AppText>
      {loading ? (
        <View style={styles.inboxLoading} accessibilityLabel="Checking enquiries and viewings">
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : failed ? (
        <Card>
          <AppText variant="label">{failed.access.state === "error" && failed.access.error instanceof ApiError && failed.access.error.code === NETWORK_ERROR ? "You’re offline" : "Couldn’t check enquiries and viewings"}</AppText>
          <Button label="Try again" variant="secondary" onPress={onRetry} testID="inbox-entry-retry" />
        </Card>
      ) : (
        <View style={styles.list}>
          {allowed.map((section, index) => {
            const total = section.access.state === "allowed" ? section.access.total : 0;
            const detail = `${total} ${section.noun[total === 1 ? 0 : 1]}`;
            return (
              <Pressable
                key={section.kind}
                accessibilityRole="button"
                accessibilityLabel={`${section.label}, ${detail}`}
                testID={`inbox-open-${section.kind}`}
                onPress={() => router.push(inboxRoute(scope, section.kind))}
                style={({ pressed }) => [styles.row, index === allowed.length - 1 && styles.itemLast, pressed && styles.rowPressed]}
              >
                <Ionicons name={section.icon} size={22} color={colors.forest} />
                <View style={styles.rowText}>
                  <AppText variant="label">{section.label}</AppText>
                  <AppText variant="caption">{detail}</AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inbox: { gap: spacing.md },
  inboxLoading: { paddingVertical: spacing.lg, alignItems: "center" },
  list: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  itemLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { flex: 1, gap: 2 },
});
