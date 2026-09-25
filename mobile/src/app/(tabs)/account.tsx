import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState, type ComponentProps } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ProfessionalWorkspace, Workspaces } from "@/api/account";
import { useProfile, useWorkspaces } from "@/api/account-queries";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useApi } from "@/api/provider";
import { useSession, type SessionNotice } from "@/auth/session";
import { loadLastWorkspace, rememberWorkspace } from "@/auth/workspaces";
import { BRAND } from "@/brand";
import { AppText, Button, Card, Notice } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, radii, spacing } from "@/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Account entry point (brief §6). Signing in is optional: guests keep browsing, saving and
 * enquiring. Signed in, the user sees their real profile and only the workspaces the server says
 * they belong to; what they can do inside each is enforced by the server.
 */
export default function AccountScreen() {
  const { apiUrl } = useApi();
  const { status, notice } = useSession();
  const version = Constants.expoConfig?.version ?? "";

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          Account
        </AppText>
        {notice ? <SignOutNotice notice={notice} /> : null}

        {status === "restoring" ? (
          <View style={styles.restoring} accessibilityLabel="Checking your sign-in">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : status === "signedIn" ? (
          <SignedInAccount />
        ) : (
          <SignedOutAccount apiUrl={apiUrl} />
        )}

        <View style={styles.group}>
          <Row icon="help-buoy-outline" label="Help & support" detail={BRAND.contact.support} onPress={() => Linking.openURL(`mailto:${BRAND.contact.support}`)} />
          <Row icon="call-outline" label="Call us" detail={BRAND.contact.phoneDisplay} onPress={() => Linking.openURL(`tel:${BRAND.contact.phoneTel}`)} />
          <Row icon="shield-checkmark-outline" label="Privacy policy" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/privacy`)} />
          <Row icon="document-text-outline" label="Terms of service" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/terms`)} last />
        </View>

        <AppText variant="caption" style={styles.version}>
          NesAfric {version}
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const SAVED_KEPT = "Your saved properties are still here.";

function formatDate(iso: string | null) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
}

/**
 * What actually happened on sign-out or session loss. Never claims the server ended the session
 * unless it answered; never claims the device forgot it unless secure storage confirmed deletion.
 */
function signOutMessages(notice: NonNullable<SessionNotice>) {
  const messages: { tone: "info" | "warning"; text: string; testID: string }[] = [];
  if (notice.kind === "expired") {
    messages.push({ tone: "warning", testID: "notice-expired", text: `You’ve been signed out because your session ended. Sign in again to see your workspaces. ${SAVED_KEPT}` });
  } else if (notice.server === "pending") {
    messages.push({ tone: "info", testID: "notice-server-pending", text: "You’re signed out on this device. Ending your session on NesAfric…" });
  } else if (notice.server === "ended") {
    messages.push({ tone: "info", testID: "notice-server-ended", text: `You’re signed out on this device and your session on NesAfric has ended. ${SAVED_KEPT}` });
  } else {
    const until = formatDate(notice.expiresAt);
    messages.push({
      tone: "warning",
      testID: "notice-server-not-confirmed",
      text: `You’re signed out on this device, but we couldn’t reach NesAfric to end the session there. It stays valid on our servers ${until ? `until ${until}` : "until it expires"}, or until you change your password on nesafric.com (which signs out every device). ${SAVED_KEPT}`,
    });
  }
  if (notice.device === "pendingDeletion") {
    messages.push({ tone: "warning", testID: "notice-device-pending", text: "We couldn’t fully remove your sign-in from this device’s secure storage. It won’t be used again, and we’ll finish removing it the next time the app opens." });
  } else if (notice.device === "failed") {
    messages.push({ tone: "warning", testID: "notice-device-failed", text: "We couldn’t remove your sign-in from this device’s secure storage, so it may come back when the app restarts. Tap Try again, or sign out again after restarting." });
  }
  return messages;
}

function SignOutNotice({ notice }: { notice: NonNullable<SessionNotice> }) {
  const { dismissNotice, retrySignOut } = useSession();
  const [retrying, setRetrying] = useState(false);
  const canRetry = notice.device === "failed" || (notice.kind === "signedOut" && notice.server === "notConfirmed");
  return (
    <View style={styles.notices}>
      {signOutMessages(notice).map((message) => (
        <View key={message.testID} testID={message.testID}>
          <Notice tone={message.tone} message={message.text} />
        </View>
      ))}
      <View style={styles.noticeActions}>
        {canRetry ? (
          <Button
            label="Try again"
            variant="secondary"
            loading={retrying}
            testID="retry-sign-out"
            onPress={async () => {
              setRetrying(true);
              await retrySignOut().finally(() => setRetrying(false));
            }}
          />
        ) : null}
        {notice.kind === "signedOut" && notice.server === "pending" ? null : <Button label="Dismiss" variant="secondary" onPress={dismissNotice} testID="dismiss-notice" />}
      </View>
    </View>
  );
}

function SignedOutAccount({ apiUrl }: { apiUrl: string }) {
  return (
    <Card style={styles.intro}>
      <AppText variant="heading">Sign in to NesAfric</AppText>
      <AppText variant="caption">
        Browsing, saving properties on this device and contacting listers work without an account. Sign in with your NesAfric account to see
        your workspaces.
      </AppText>
      <Button label="Sign in" onPress={() => router.push("/sign-in")} testID="open-sign-in" />
      <Button label="Create an account on nesafric.com" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/register`)} />
    </Card>
  );
}

function SignedInAccount() {
  const { user, signOut } = useSession();
  const profile = useProfile();
  const workspaces = useWorkspaces();
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !workspaces.data) return;
    let cancelled = false;
    void loadLastWorkspace(user.id, workspaces.data).then((id) => !cancelled && setLastWorkspace(id));
    return () => {
      cancelled = true;
    };
  }, [user, workspaces.data]);

  const displayName = profile.data?.displayName ?? user?.displayName ?? "";
  const email = profile.data?.email ?? user?.email ?? "";

  return (
    <>
      <Card style={styles.profile}>
        <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
          <AppText style={styles.avatarText}>{initials(displayName)}</AppText>
        </View>
        <View style={styles.profileText}>
          <AppText variant="label" accessibilityLabel={`Signed in as ${displayName}`}>
            {displayName}
          </AppText>
          <AppText variant="caption">{email}</AppText>
        </View>
      </Card>

      <View style={styles.section}>
        <AppText variant="heading" accessibilityRole="header">
          Your workspaces
        </AppText>
        <WorkspaceList
          workspaces={workspaces.data}
          isPending={workspaces.isPending}
          error={workspaces.error}
          onRetry={() => workspaces.refetch()}
          lastWorkspace={lastWorkspace}
          onOpenOrganisation={(organisationId) => {
            if (user) void rememberWorkspace(user.id, organisationId);
            setLastWorkspace(organisationId);
            router.push({ pathname: "/workspace/[organisationId]", params: { organisationId } });
          }}
        />
      </View>

      <Button
        label="Sign out"
        variant="secondary"
        testID="sign-out"
        // Local sign-out is immediate; server revocation continues in the background.
        onPress={() => void signOut()}
      />
    </>
  );
}

function WorkspaceList(props: {
  workspaces: Workspaces | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  lastWorkspace: string | null;
  onOpenOrganisation: (organisationId: string) => void;
}) {
  const { workspaces, isPending, error, onRetry, lastWorkspace, onOpenOrganisation } = props;

  if (isPending) {
    return (
      <View style={styles.restoring} accessibilityLabel="Loading your workspaces">
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!workspaces) {
    const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
    return (
      <Card>
        <AppText variant="label">{offline ? "You’re offline" : "Couldn’t load your workspaces"}</AppText>
        <AppText variant="caption">{offline ? "Check your connection. Browsing saved properties still works." : error instanceof Error ? error.message : "Please try again."}</AppText>
        <Button label="Try again" variant="secondary" onPress={onRetry} />
      </Card>
    );
  }

  return (
    <View>
      <View style={styles.group}>
        <Row
          icon="home-outline"
          label="Personal"
          detail="Browse, save and enquire about properties"
          onPress={() => router.navigate("/")}
          last={workspaces.propertyOsOrganisations.length === 0 && workspaces.marketplaceProfessionals.length === 0}
        />
        {workspaces.propertyOsOrganisations.map((organisation, index) => (
          <Row
            key={organisation.id}
            icon="business-outline"
            label={organisation.name}
            detail={organisation.id === lastWorkspace ? "Property management · last opened" : "Property management"}
            onPress={() => onOpenOrganisation(organisation.id)}
            testID={`workspace-${organisation.id}`}
            last={index === workspaces.propertyOsOrganisations.length - 1 && workspaces.marketplaceProfessionals.length === 0}
          />
        ))}
        {workspaces.marketplaceProfessionals.map((professional, index) => (
          <Row
            key={professional.id}
            icon="briefcase-outline"
            label={professional.displayName}
            detail={professionalLabel(professional)}
            onPress={() => router.push({ pathname: "/agent/[professionalId]", params: { professionalId: professional.id } })}
            testID={`agent-${professional.id}`}
            last={index === workspaces.marketplaceProfessionals.length - 1}
          />
        ))}
      </View>
      {workspaces.propertyOsOrganisations.length === 0 && workspaces.marketplaceProfessionals.length === 0 ? (
        <AppText variant="caption" style={styles.hint}>
          You’re not a member of a landlord, property management or professional workspace yet. When someone invites you, or you set one up on
          nesafric.com, it will appear here.
        </AppText>
      ) : null}
    </View>
  );
}

function professionalLabel(professional: ProfessionalWorkspace) {
  return `${humanise(professional.type)} · ${humanise(professional.myRole)}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "N";
}

function Row({ icon, label, detail, onPress, last = false, testID }: { icon: IconName; label: string; detail?: string; onPress: () => void; last?: boolean; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={22} color={colors.forest} />
      <View style={styles.rowText}>
        <AppText variant="label">{label}</AppText>
        {detail ? <AppText variant="caption">{detail}</AppText> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  notices: { gap: spacing.sm },
  noticeActions: { gap: spacing.sm },
  intro: { gap: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.gold },
  restoring: { paddingVertical: spacing.xl, alignItems: "center" },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.white, fontFamily: "NotoSans-Bold", fontSize: 17 },
  profileText: { flex: 1, gap: 2 },
  section: { gap: spacing.md },
  hint: { marginTop: spacing.sm },
  group: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.hairline, minHeight: 56 },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { flex: 1, gap: 2 },
  version: { textAlign: "center" },
});
