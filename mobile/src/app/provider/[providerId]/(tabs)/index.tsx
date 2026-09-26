import { View } from "react-native";

import { useProviderMetrics, useProviderProfile } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText, Notice } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { useWorkspaceGate } from "@/workspace/inbox-ui";
import { Heading, QuerySection, Stat, StatRow, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

/**
 * Service provider dashboard: the profile's status and job metrics, from the provider routes the
 * server opens only to the provider's owner.
 */
export default function ProviderDashboard() {
  const { provider, workspaceId } = useWorkspaceGate("provider", useWorkspaceParam("provider"));
  const profile = useProviderProfile(workspaceId);
  const metrics = useProviderMetrics(workspaceId);
  if (!workspaceId) return null;

  return (
    <WorkspaceScroll refreshing={profile.isRefetching || metrics.isRefetching} onRefresh={() => void Promise.all([profile.refetch(), metrics.refetch()])}>
      <View>
        <AppText variant="caption">Service provider workspace</AppText>
        <AppText variant="title" accessibilityRole="header">
          {profile.data?.displayName ?? provider?.displayName}
        </AppText>
      </View>
      {provider?.suspended ? <Notice tone="warning" message="This profile is suspended by NesAfric, so it can’t receive new work. Contact NesAfric support if you think this is a mistake." /> : null}

      <QuerySection query={profile} what="this profile">
        {(data) => (
          <RowGroup>
            <ListRow icon="shield-checkmark-outline" title="Verification" detail={humanise(data.verificationStatus)} />
            <ListRow icon="time-outline" title="Availability" detail={humanise(data.availabilityStatus)} />
            <ListRow icon="checkmark-done-outline" title="Accepting work" detail={data.acceptingWork ? "Yes" : "No"} last />
          </RowGroup>
        )}
      </QuerySection>

      <Heading>Jobs</Heading>
      <QuerySection query={metrics} what="job metrics">
        {(data) => (
          <>
            <StatRow>
              <Stat label="Assigned" value={data.assignments} />
              <Stat label="Completed" value={data.completed} />
              <Stat label="Acceptance" value={percent(data.acceptanceRate)} />
            </StatRow>
            <AppText variant="caption">{data.ratings ? `Rated ${data.averageRating?.toFixed(1) ?? "—"} from ${data.ratings} ${data.ratings === 1 ? "rating" : "ratings"}` : "No ratings yet."}</AppText>
          </>
        )}
      </QuerySection>
    </WorkspaceScroll>
  );
}
