import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import type { Enquiry } from "@/api/inbox";
import { useEnquiry, useInboxAccess } from "@/api/inbox-queries";
import { AppText } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, spacing } from "@/theme/tokens";
import { DetailFrame } from "@/workspace/detail-frame";
import { ContactActions, Fact, formatDateTime, Section, StatusPill, Timeline, useWorkspaceGate, viewingWhen } from "@/workspace/inbox-ui";
import { viewingRoute, webPath, type InboxScope } from "@/workspace/scope";

/** Read-only enquiry, fetched for this workspace only (`view=inbox`, re-checked by the server). */
export function EnquiryScreen({ kind, id, leadId }: { kind: InboxScope["kind"]; id: string | undefined; leadId: string | undefined }) {
  const { gate, scope } = useWorkspaceGate(kind, id);
  const enquiry = useEnquiry(scope, leadId);
  const access = useInboxAccess(scope);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  // While the full detail loads, the list row (a summary) is shown as a header only.
  const summary = enquiry.data;
  const lead = enquiry.isPlaceholderData ? null : (enquiry.data as Enquiry | undefined);
  const canOpenViewings = access.viewings.state === "allowed";

  return (
    <DetailFrame query={enquiry} noun="enquiry" webPath={webPath(scope!, { kind: "enquiry", id: leadId ?? "" })}>
      {summary && !lead ? (
        <View style={styles.header}>
          <StatusPill status={summary.status} />
          <AppText variant="title" accessibilityRole="header">
            {summary.name}
          </AppText>
          <AppText>{summary.listing.title}</AppText>
          <ActivityIndicator color={colors.brand} accessibilityLabel="Loading the rest of this enquiry" />
        </View>
      ) : null}
      {lead ? (
        <>
          <View style={styles.header}>
            <StatusPill status={lead.status} />
            <AppText variant="title" accessibilityRole="header">
              {lead.name}
            </AppText>
            <AppText>{lead.listing.title}</AppText>
            <AppText variant="caption">Received {formatDateTime(lead.createdAt)}</AppText>
          </View>

          <Section title="Contact">
            <ContactActions name={lead.name} phone={lead.phone} email={lead.email} />
          </Section>

          {lead.message ? (
            <Section title="Message">
              <AppText selectable>{lead.message}</AppText>
            </Section>
          ) : null}

          <Section title="Details">
            <Fact label="Listing" value={`${lead.listing.title} · ${humanise(lead.listing.listingType)}`} />
            <Fact label="Source" value={lead.source ? humanise(lead.source) : null} />
            <Fact label="Assigned to" value={lead.assignee?.user?.displayName ?? "Not assigned"} />
            <Fact label="Last activity" value={formatDateTime(lead.lastActivityAt)} />
            <Fact label="Applications" value={lead.rentalApplications.length ? `${lead.rentalApplications.length} (${lead.rentalApplications.map((app) => humanise(app.status)).join(", ")})` : null} />
          </Section>

          {lead.viewingRequests.length ? (
            <Section title="Viewing requests">
              {lead.viewingRequests.map((viewing) => {
                const content = (
                  <>
                    <StatusPill status={viewing.status} />
                    <AppText variant="caption">{viewingWhen(viewing)}</AppText>
                  </>
                );
                return canOpenViewings ? (
                  <Pressable
                    key={viewing.id}
                    accessibilityRole="button"
                    style={styles.viewing}
                    onPress={() => router.push(viewingRoute(scope!, viewing.id))}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View key={viewing.id} style={styles.viewing}>
                    {content}
                  </View>
                );
              })}
            </Section>
          ) : null}

          <Section title="Status history">
            <Timeline history={lead.history} />
          </Section>
        </>
      ) : null}
    </DetailFrame>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.xs },
  viewing: { gap: spacing.xs, paddingVertical: spacing.xs },
});
