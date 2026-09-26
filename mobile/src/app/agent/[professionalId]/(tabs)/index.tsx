import { View } from "react-native";

import { useInboxAccess } from "@/api/inbox-queries";
import { useProDashboard } from "@/api/workspace-queries";
import { AppText, Notice } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { InboxEntry } from "@/workspace/inbox-entry";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { Heading, QuerySection, Stat, StatRow, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

/**
 * Real estate professional dashboard. Listed only if `/api/workspaces` says this person is an
 * active member of the profile; the numbers and the inbox are scoped by the server to the
 * professional's own listings.
 */
export default function ProfessionalDashboard() {
  const { scope, professional } = useWorkspaceGate("professional", useWorkspaceParam("professional"));
  const dashboard = useProDashboard(scope?.id ?? null);
  const inbox = useInboxAccess(scope);
  if (!scope) return null;

  return (
    <WorkspaceScroll refreshing={dashboard.isRefetching} onRefresh={() => void Promise.all([dashboard.refetch(), inbox.retry()])}>
      <View>
        <AppText variant="caption">{professional ? `${humanise(professional.type)} · your role: ${humanise(professional.myRole)}` : "Real estate professional"}</AppText>
        <AppText variant="title" accessibilityRole="header">
          {professional?.displayName}
        </AppText>
      </View>
      {professional && professional.status !== "ACTIVE" ? <Notice tone="warning" message={`This profile is ${humanise(professional.status).toLowerCase()}. Contact NesAfric support if you think this is a mistake.`} /> : null}

      <QuerySection query={dashboard} what="this dashboard">
        {(data) => (
          <>
            <StatRow>
              <Stat label="Live listings" value={data.listings.active} />
              <Stat label="New leads" value={data.newLeads} />
              <Stat label="Upcoming viewings" value={data.upcomingViewings} />
            </StatRow>
            <StatRow>
              <Stat label="Drafts" value={data.listings.draft} />
              <Stat label="In review" value={data.listings.pendingReview} />
              <Stat label="Paused" value={data.listings.paused} />
            </StatRow>
            <AppText variant="caption" testID="listing-breakdown">
              {`${data.listings.total} listings in total · ${data.listings.draft} draft · ${data.listings.pendingReview} in review · ${data.listings.paused} paused`}
            </AppText>
            <AppText variant="caption">{`Profile ${data.profileCompletenessPercent}% complete · ${humanise(data.verificationStatus)}`}</AppText>
          </>
        )}
      </QuerySection>

      <Heading>Enquiries and viewings</Heading>
      <InboxEntry scope={scope} access={inbox} />
    </WorkspaceScroll>
  );
}
