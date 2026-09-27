import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import type { Viewing } from "@/api/inbox";
import { useInboxAccess, useViewing } from "@/api/inbox-queries";
import { AppText } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, spacing } from "@/theme/tokens";
import { DetailFrame } from "@/workspace/detail-frame";
import { ContactActions, Fact, formatDateTime, formatWindow, Section, StatusPill, Timeline, useWorkspaceGate } from "@/workspace/inbox-ui";
import { enquiryRoute, webPath, type InboxScope } from "@/workspace/scope";

/** Read-only viewing request, fetched for this workspace only (`view=inbox`, re-checked by the server). */
export function ViewingScreen({ kind, id, viewingId }: { kind: InboxScope["kind"]; id: string | undefined; viewingId: string | undefined }) {
  const { gate, scope } = useWorkspaceGate(kind, id);
  const viewing = useViewing(scope, viewingId);
  const access = useInboxAccess(scope);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  // While the full detail loads, the list row (a summary) is shown as a header only.
  const summary = viewing.data;
  const item = viewing.isPlaceholderData ? null : (viewing.data as Viewing | undefined);
  const canOpenEnquiry = access.enquiries.state === "allowed";

  return (
    <DetailFrame query={viewing} noun="viewing request" webPath={webPath(scope!, { kind: "viewing", id: viewingId ?? "" })}>
      {summary && !item ? (
        <View style={styles.header}>
          <StatusPill status={summary.status} />
          <AppText variant="title" accessibilityRole="header">
            {summary.lead.name}
          </AppText>
          <AppText>{summary.listing.title}</AppText>
          <ActivityIndicator color={colors.brand} accessibilityLabel="Loading the rest of this viewing request" />
        </View>
      ) : null}
      {item ? (
        <>
          <View style={styles.header}>
            <StatusPill status={item.status} />
            <AppText variant="title" accessibilityRole="header">
              {item.lead.name}
            </AppText>
            <AppText>{item.listing.title}</AppText>
            <AppText variant="caption">Requested {formatDateTime(item.createdAt)}</AppText>
          </View>

          <Section title="When">
            {item.confirmedStartsAt ? (
              <Fact label="Confirmed" value={[formatDateTime(item.confirmedStartsAt), formatDateTime(item.confirmedEndsAt)].filter(Boolean).join(" – ")} />
            ) : null}
            {item.preferredTimes.length ? (
              <View style={styles.times}>
                <AppText variant="caption">Preferred times</AppText>
                {item.preferredTimes.map((time) => (
                  <AppText key={time.id}>{formatWindow(time)}</AppText>
                ))}
              </View>
            ) : (
              <AppText variant="caption">No preferred times were given.</AppText>
            )}
          </Section>

          <Section title="Contact">
            <ContactActions name={item.lead.name} phone={item.lead.phone} email={item.lead.email} />
          </Section>

          {item.requesterNote ? (
            <Section title="Note from the requester">
              <AppText selectable>{item.requesterNote}</AppText>
            </Section>
          ) : null}

          <Section title="Details">
            <Fact label="Listing" value={`${item.listing.title} · ${humanise(item.listing.listingType)}`} />
            <Fact label="Assigned to" value={item.assignee?.user?.displayName ?? "Not assigned"} />
            <Fact label="Outcome" value={item.outcome} />
            {canOpenEnquiry ? (
              <Pressable
                accessibilityRole="button"
                testID="open-enquiry"
                onPress={() => router.push(enquiryRoute(scope!, item.lead.id))}
              >
                <Fact label="Enquiry" value={`${item.lead.name} · ${humanise(item.lead.status)} ›`} />
              </Pressable>
            ) : null}
          </Section>

          <Section title="Status history">
            <Timeline history={item.history} />
          </Section>
        </>
      ) : null}
    </DetailFrame>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.xs },
  times: { gap: spacing.xs },
});
