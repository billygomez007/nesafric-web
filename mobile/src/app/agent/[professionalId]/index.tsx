import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useInboxAccess } from "@/api/inbox-queries";
import { useApi } from "@/api/provider";
import { AppText, Button, Card, Notice } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, spacing } from "@/theme/tokens";
import { InboxEntry } from "@/workspace/inbox-entry";
import { useWorkspaceGate } from "@/workspace/inbox-ui";

/**
 * Agent / marketplace professional workspace. Listed only if `/api/workspaces` says this person is
 * an active member of the profile; the enquiry and viewing inbox is scoped by the server to the
 * professional's own listings (including listings it markets for landlords).
 */
export default function AgentWorkspaceScreen() {
  const params = useLocalSearchParams<{ professionalId: string }>();
  const { gate, scope, professional } = useWorkspaceGate("professional", params.professionalId);
  const inbox = useInboxAccess(scope);
  const { apiUrl } = useApi();
  const insets = useSafeAreaInsets();

  if (gate) return <View style={styles.screen}>{gate}</View>;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: professional?.displayName ?? "Agent workspace" }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void inbox.retry()} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <AppText variant="caption">{professional ? `${humanise(professional.type)} · your role: ${humanise(professional.myRole)}` : "Agent workspace"}</AppText>
          <AppText variant="title" accessibilityRole="header">
            {professional?.displayName}
          </AppText>
        </View>
        {professional && professional.status !== "ACTIVE" ? <Notice tone="warning" message={`This profile is ${humanise(professional.status).toLowerCase()}. Contact NesAfric support if you think this is a mistake.`} /> : null}

        <InboxEntry scope={scope!} access={inbox} />

        <Card>
          <AppText variant="label">Listings, team and promotions</AppText>
          <AppText variant="caption">Replying to enquiries, updating their status and managing listings happen on nesafric.com for now.</AppText>
        </Card>
        <Button label="Open on nesafric.com" variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(`${apiUrl}/pro/${scope!.id}`)} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  header: { gap: 2 },
});
