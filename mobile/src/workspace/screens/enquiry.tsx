import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { useEnquiry, useInboxAccess } from "@/api/inbox-queries";
import { AppText } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, spacing } from "@/theme/tokens";
import { DetailFrame } from "@/workspace/detail-frame";
import { ContactActions, Fact, formatDateTime, Section, StatusPill, Timeline, useWorkspaceGate, viewingWhen } from "@/workspace/inbox-ui";

/** Read-only enquiry. Data comes from `GET /api/marketplace-leads/:id` for this workspace only. */
export default function EnquiryScreen() {
  const params = useLocalSearchParams<{ organisationId: string; leadId: string }>();
  const { gate, organisationId } = useWorkspaceGate(params.organisationId);
  const enquiry = useEnquiry(organisationId, params.leadId);
  const access = useInboxAccess(organisationId);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  const lead = enquiry.data;
  const canOpenViewings = access.viewings.state === "allowed";

  return (
    <DetailFrame query={enquiry} noun="enquiry" webPath={`/leasing/leads/${params.leadId}`}>
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
                    onPress={() => router.push({ pathname: "/workspace/[organisationId]/viewing/[viewingId]", params: { organisationId: params.organisationId, viewingId: viewing.id } })}
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
