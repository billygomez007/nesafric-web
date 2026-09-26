import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkspaces } from "@/api/account-queries";
import { useSession } from "@/auth/session";
import { rememberWorkspace } from "@/auth/workspaces";
import { ListRow, RowGroup, type IconName } from "@/components/list-row";
import { AppText, Loading } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import { resolveAvailableWorkspaces, sameWorkspace, type AvailableWorkspace, type WorkspaceKind, type WorkspaceRef } from "@/workspace/resolve";

const ICONS: Record<WorkspaceKind, IconName> = {
  marketplace: "storefront-outline",
  property_management: "business-outline",
  professional: "briefcase-outline",
  service_provider: "construct-outline",
};

/**
 * Workspace switcher. Lists only what `resolveAvailableWorkspaces` returns for the server's
 * current workspace list, with Marketplace always first. `kind`/`id` in the route only mark the
 * current workspace; they never add one.
 */
export default function SwitchWorkspaceScreen() {
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const { status, user } = useSession();
  const workspaces = useWorkspaces();
  const insets = useSafeAreaInsets();
  const current: WorkspaceRef = params.kind && params.kind !== "marketplace" ? { kind: params.kind as WorkspaceKind, id: params.id || null } : { kind: "marketplace", id: null };
  const available = resolveAvailableWorkspaces({ status, workspaces: workspaces.data });

  function choose(workspace: AvailableWorkspace) {
    if (user) void rememberWorkspace(user.id, workspace);
    router.dismissTo(workspace.route);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}>
      <AppText variant="caption">Choose where you want to work. You can come back to the marketplace at any time.</AppText>
      {status === "signedIn" && workspaces.isPending ? (
        <Loading />
      ) : (
        <RowGroup>
          {available.map((workspace, index) => {
            const selected = sameWorkspace(workspace, current);
            const isMarketplace = workspace.kind === "marketplace";
            return (
              <ListRow
                key={`${workspace.kind}:${workspace.id ?? ""}`}
                icon={ICONS[workspace.kind]}
                title={isMarketplace ? "Switch to Marketplace" : workspace.name}
                detail={workspace.subtitle}
                selected={selected}
                onPress={() => choose(workspace)}
                testID={`switch-${workspace.kind}${workspace.id ? `-${workspace.id}` : ""}`}
                last={index === available.length - 1}
              />
            );
          })}
        </RowGroup>
      )}
      {available.length === 1 ? (
        <View>
          <AppText variant="caption">You don’t have a management workspace yet. Set one up from the Account tab.</AppText>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
});
