import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { websiteUrl } from "@/config";

import { useProfile, useWorkspaces } from "@/api/account-queries";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useApi } from "@/api/provider";
import type { Tenancy } from "@/api/tenant";
import { useTenancies } from "@/api/tenant-queries";
import { useSession, type SessionNotice } from "@/auth/session";
import { loadLastWorkspace, rememberWorkspace } from "@/auth/workspaces";
import { BRAND } from "@/brand";
import { GatewayCard } from "@/components/gateway-card";
import { ListRow, RowGroup, type IconName } from "@/components/list-row";
import { AppText, Button, Card, Notice } from "@/components/ui";
import { leaseLabel } from "@/tenant/maintenance";
import { colors, fonts, spacing } from "@/theme/tokens";
import { setWorkspaceIntent, useWorkspaceIntent } from "@/workspace/intent";
import {
  hasWorkspaceKind,
  resolveAvailableWorkspaces,
  resolveInitialWorkspace,
  sameWorkspace,
  isWorkspaceIntent,
  WORKSPACE_KIND_LABEL,
  type AvailableWorkspace,
  type EntryIntent,
  type WorkspaceIntent,
  type WorkspaceKind,
  type WorkspaceRef,
} from "@/workspace/resolve";
import { SETUP_PATH } from "@/workspace/routing";
import { openSwitcher } from "@/workspace/shell";

/**
 * Account entry point (brief §6). Signing in is optional: guests keep browsing, saving and
 * enquiring. Signed in, the user sees their real profile and only the workspaces the server says
 * they belong to; what they can do inside each is enforced by the server.
 */
export default function AccountScreen() {
  const { apiUrl } = useApi();
  const { status, notice } = useSession();
  const workspaces = useWorkspaces();
  const version = Constants.expoConfig?.version ?? "";

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={status === "signedIn" ? <RefreshControl refreshing={workspaces.isRefetching} onRefresh={() => void workspaces.refetch()} tintColor={colors.brand} /> : undefined}
      >
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
          <SignedOutAccount />
        )}

        <RowGroup>
          <ListRow icon="help-buoy-outline" title="Help & support" detail={BRAND.contact.support} onPress={() => Linking.openURL(`mailto:${BRAND.contact.support}`)} />
          <ListRow icon="call-outline" title="Call us" detail={BRAND.contact.phoneDisplay} onPress={() => Linking.openURL(`tel:${BRAND.contact.phoneTel}`)} />
          <ListRow icon="shield-checkmark-outline" title="Privacy policy" onPress={() => WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `/privacy`))} />
          <ListRow icon="document-text-outline" title="Terms of service" onPress={() => WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `/terms`))} last />
        </RowGroup>

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

const GATEWAY: { intent: WorkspaceIntent; icon: IconName; title: string; description: string }[] = [
  { intent: "property_management", icon: "business-outline", title: "Landlord & Property Manager", description: "Manage properties, units, tenants, leases, rent and maintenance." },
  {
    intent: "professional",
    icon: "briefcase-outline",
    title: "Real Estate Professional",
    description: "For agents, agencies, developers and property companies. Manage listings, leads, enquiries and your marketplace presence.",
  },
  { intent: "service_provider", icon: "construct-outline", title: "Service Provider", description: "Manage services, jobs, requests, customers and your business profile." },
];

/** Marketplace first: property seekers sign in only if they want to; the cards below are for people who manage on NesAfric. */
function SignedOutAccount() {
  const intent = useWorkspaceIntent();
  return (
    <>
      <Card style={styles.intro} testID="gateway-seeker">
        <AppText variant="heading" accessibilityRole="header">
          Looking for property?
        </AppText>
        <AppText variant="caption">Sign in to save properties, manage enquiries and keep track of viewings.</AppText>
        <Button label="Sign in / Create account" onPress={() => { setWorkspaceIntent(null); router.push("/sign-in"); }} testID="open-sign-in" />
      </Card>

      <View style={styles.section}>
        <AppText style={styles.eyebrow} accessibilityRole="header">
          RENTING A HOME
        </AppText>
        <GatewayCard
          icon="key-outline"
          title="Tenant / Renter"
          description="Sign in to view your rented home, lease details, payments, maintenance and messages."
          highlighted={intent === "tenant"}
          testID="gateway-tenant"
          onPress={() => {
            // Wording only: the homes shown after sign-in are the ones the server links to this account.
            setWorkspaceIntent("tenant");
            router.push({ pathname: "/sign-in", params: { intent: "tenant" } });
          }}
        />
      </View>

      <View style={styles.section}>
        <AppText style={styles.eyebrow} accessibilityRole="header">
          MANAGE ON NESAFRIC
        </AppText>
        {GATEWAY.map((card) => (
          <GatewayCard
            key={card.intent}
            icon={card.icon}
            title={card.title}
            description={card.description}
            highlighted={intent === card.intent}
            testID={`gateway-${card.intent}`}
            onPress={() => {
              // Intent only: what the account can actually open is decided by the server after sign-in.
              setWorkspaceIntent(card.intent);
              router.push({ pathname: "/sign-in", params: { intent: card.intent } });
            }}
          />
        ))}
      </View>
    </>
  );
}

// Onboarding offers, not access: each opens set-up on the website; a workspace appears only once
// the server lists it.
const OFFERS: Record<WorkspaceIntent, { title: string; detail: string; path: string; icon: IconName }> = {
  property_management: { title: "Set up Property Management", detail: "For landlords, property managers and property companies", path: SETUP_PATH.property_management, icon: "business-outline" },
  professional: { title: "Register as a Real Estate Professional", detail: "For agents, agencies, developers and property companies", path: SETUP_PATH.professional, icon: "briefcase-outline" },
  service_provider: { title: "Register as a Service Provider", detail: "For artisans, contractors and service businesses", path: SETUP_PATH.service_provider, icon: "construct-outline" },
};

const ICONS: Record<WorkspaceKind, IconName> = {
  marketplace: "storefront-outline",
  property_management: "business-outline",
  professional: "briefcase-outline",
  service_provider: "construct-outline",
};

const ROW_TEST_ID: Record<WorkspaceKind, string> = { marketplace: "workspace-marketplace", property_management: "workspace", professional: "agent", service_provider: "provider" };

function SignedInAccount() {
  const { user, status, signOut } = useSession();
  const { apiUrl } = useApi();
  const profile = useProfile();
  const workspaces = useWorkspaces();
  const tenancies = useTenancies();
  const intent = useWorkspaceIntent();
  const [lastWorkspace, setLastWorkspace] = useState<WorkspaceRef | null>(null);

  useEffect(() => {
    if (!user || !workspaces.data) return;
    let cancelled = false;
    void loadLastWorkspace(user.id, workspaces.data).then((ref) => !cancelled && setLastWorkspace(ref));
    return () => {
      cancelled = true;
    };
  }, [user, workspaces.data]);

  const displayName = profile.data?.displayName ?? user?.displayName ?? "";
  // A phone-only account has no email: show the phone number instead.
  const email = profile.data?.email ?? user?.email ?? profile.data?.phone ?? user?.phone ?? "";
  const session = { status, workspaces: workspaces.data };
  const available = resolveAvailableWorkspaces(session);
  const continueIn = resolveInitialWorkspace(session, lastWorkspace);
  const missing = (Object.keys(OFFERS) as WorkspaceIntent[]).filter((kind) => !hasWorkspaceKind(available, kind));
  // The tapped card only reorders and highlights; it never adds a workspace.
  const offers = isWorkspaceIntent(intent) && missing.includes(intent) ? [intent, ...missing.filter((kind) => kind !== intent)] : missing;

  async function openOffer(kind: WorkspaceIntent) {
    await WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `${OFFERS[kind].path}`));
    // Back from the website: pick up a workspace that was just set up.
    void workspaces.refetch();
  }

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

      {isWorkspaceIntent(intent) && workspaces.data ? <IntentNotice intent={intent} available={available} /> : null}
      {intent === "tenant" && tenancies.data ? <TenantIntentNotice tenancies={tenancies.data} /> : null}

      {workspaces.data ? (
        <View style={styles.section} testID="current-workspace">
          <AppText variant="heading" accessibilityRole="header">
            Current workspace
          </AppText>
          <RowGroup>
            {continueIn.kind !== "marketplace" ? (
              <ListRow icon={ICONS[continueIn.kind]} title={`Continue in ${continueIn.name}`} detail={continueIn.subtitle} onPress={() => router.push(continueIn.route)} testID="continue-workspace" />
            ) : (
              <ListRow icon="storefront-outline" title="Marketplace" detail="You’re browsing the marketplace" />
            )}
            <ListRow icon="swap-horizontal-outline" title="Switch workspace" detail={available.length > 1 ? `${available.length} workspaces available` : "Marketplace only"} onPress={() => openSwitcher("marketplace", null)} testID="open-switcher" />
            <ListRow icon="search-outline" title="Browse Marketplace" onPress={() => router.navigate("/")} testID="browse-marketplace" />
            <ListRow icon="settings-outline" title="Account settings" detail="Name, email and password on nesafric.com" accessibilityHint="Opens nesafric.com" onPress={() => void WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `/settings`))} testID="account-settings" last />
          </RowGroup>
        </View>
      ) : null}

      <HomesSection tenancies={tenancies.data} error={tenancies.error} onRetry={() => tenancies.refetch()} />

      <View style={styles.section} testID="tenant-access-section">
        <AppText variant="heading" accessibilityRole="header">
          Renting with NesAfric?
        </AppText>
        <AppText variant="caption">
          If your landlord or property manager gave you a tenant access code, connect it to this account.
        </AppText>
        <Button
          label="Enter tenant access code"
          variant="secondary"
          onPress={() => router.push("/tenant-access")}
          testID="open-tenant-access"
        />
      </View>

      <View style={styles.section}>
        <AppText variant="heading" accessibilityRole="header">
          Your workspaces
        </AppText>
        <WorkspaceList available={workspaces.data ? available : undefined} isPending={workspaces.isPending} error={workspaces.error} onRetry={() => workspaces.refetch()} lastWorkspace={lastWorkspace} intent={intent} />
      </View>

      {workspaces.data && offers.length ? (
        <View style={styles.section} testID="offers">
          <AppText variant="heading" accessibilityRole="header">
            Manage on NesAfric
          </AppText>
          <RowGroup>
            {offers.map((kind, index) => (
              <ListRow
                key={kind}
                icon={OFFERS[kind].icon}
                title={OFFERS[kind].title}
                detail={OFFERS[kind].detail}
                highlighted={intent === kind}
                accessibilityHint="Opens nesafric.com"
                onPress={() => void openOffer(kind)}
                testID={`offer-${kind}`}
                last={index === offers.length - 1}
              />
            ))}
          </RowGroup>
          <AppText variant="caption">These open nesafric.com. Sign in there with the same account; your new workspace appears here when you come back.</AppText>
        </View>
      ) : null}

      <Button
        label="Sign out"
        variant="secondary"
        testID="sign-out"
        // Local sign-out is immediate; server revocation continues in the background.
        onPress={() => {
          setWorkspaceIntent(null);
          void signOut();
        }}
      />
    </>
  );
}

function IntentNotice({ intent, available }: { intent: WorkspaceIntent; available: AvailableWorkspace[] }) {
  const matching = available.filter((workspace) => workspace.kind === intent);
  const label = WORKSPACE_KIND_LABEL[intent].toLowerCase();
  return (
    <View style={styles.notices} testID="intent-notice">
      {matching.length ? (
        <>
          <Notice tone="info" message={matching.length === 1 ? `Your ${label} workspace is ready.` : `You have ${matching.length} ${label} workspaces.`} />
          {matching.length === 1 ? <Button label={`Open ${matching[0].name}`} onPress={() => router.push(matching[0].route)} testID="intent-open" /> : null}
        </>
      ) : (
        <Notice tone="info" message={`This account doesn’t have a ${label} workspace yet. You can set one up below.`} />
      )}
      <Button label="Dismiss" variant="secondary" onPress={() => setWorkspaceIntent(null)} testID="intent-dismiss" />
    </View>
  );
}

/**
 * After signing in from the Tenant card: the homes come only from the server's tenancy list. With
 * none linked yet, the next step is the tenant access code from the landlord — nothing is assumed.
 */
function TenantIntentNotice({ tenancies }: { tenancies: Tenancy[] }) {
  const only = tenancies.length === 1 ? tenancies[0] : null;
  return (
    <View style={styles.notices} testID="tenant-intent-notice">
      {tenancies.length ? (
        <>
          <Notice tone="info" message={only ? "Your rented home is linked to this account." : `You have ${tenancies.length} rented homes linked to this account. Choose one under Your homes.`} />
          {only ? (
            <Button
              label="Open your home"
              onPress={() => router.push({ pathname: "/home/[tenancyId]", params: { tenancyId: only.tenantOrganisationId } })}
              testID="tenant-intent-open"
            />
          ) : null}
        </>
      ) : (
        <>
          <Notice tone="info" message="No rented home is linked to this account yet. Enter the tenant access code your landlord or property manager gave you to connect it." />
          <Button label="Enter tenant access code" onPress={() => router.push("/tenant-access")} testID="tenant-intent-access-code" />
        </>
      )}
      <Button label="Dismiss" variant="secondary" onPress={() => setWorkspaceIntent(null)} testID="tenant-intent-dismiss" />
    </View>
  );
}

function WorkspaceList(props: {
  available: AvailableWorkspace[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  lastWorkspace: WorkspaceRef | null;
  intent: EntryIntent | null;
}) {
  const { available, isPending, error, onRetry, lastWorkspace, intent } = props;
  const userId = useSession().user?.id;

  if (isPending) {
    return (
      <View style={styles.restoring} accessibilityLabel="Loading your workspaces">
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!available) {
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
      <RowGroup>
        {available.map((workspace, index) => (
          <ListRow
            key={`${workspace.kind}:${workspace.id ?? ""}`}
            icon={ICONS[workspace.kind]}
            title={workspace.name}
            detail={sameWorkspace(workspace, lastWorkspace) ? `${workspace.subtitle} · last opened` : workspace.subtitle}
            highlighted={workspace.kind === intent}
            onPress={() => {
              if (workspace.kind !== "marketplace") return router.push(workspace.route);
              // Choosing the marketplace is a choice too: the next launch opens it, not a workspace.
              if (userId) void rememberWorkspace(userId, workspace);
              router.navigate("/");
            }}
            testID={workspace.id ? `${ROW_TEST_ID[workspace.kind]}-${workspace.id}` : ROW_TEST_ID.marketplace}
            last={index === available.length - 1}
          />
        ))}
      </RowGroup>
      {available.length === 1 ? (
        <AppText variant="caption" style={styles.hint}>
          You’re not a member of a landlord, property management, professional or service provider workspace yet. When someone invites you, or you set one up
          on nesafric.com, it will appear here.
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Homes the user rents, as linked to their account by the landlord or property manager (server
 * list). Hidden when there are none; a failed check never blocks the rest of the account screen.
 */
function HomesSection({ tenancies, error, onRetry }: { tenancies: Tenancy[] | undefined; error: unknown; onRetry: () => void }) {
  if (!tenancies) {
    if (!error) return null;
    return (
      <Card style={styles.homesError}>
        <AppText variant="caption">Couldn’t check for homes you rent.</AppText>
        <Button label="Try again" variant="secondary" onPress={onRetry} testID="homes-retry" />
      </Card>
    );
  }
  if (!tenancies.length) return null;
  return (
    <View style={styles.section}>
      <AppText variant="heading" accessibilityRole="header">
        Your homes
      </AppText>
      <RowGroup>
        {tenancies.map((tenancy, index) => (
          <ListRow
            key={tenancy.tenantOrganisationId}
            icon="key-outline"
            title={tenancy.leases.length ? tenancy.leases.map(leaseLabel).join(", ") : tenancy.organisation.name}
            detail={tenancy.leases.length ? `Rented through ${tenancy.organisation.name}` : "No current lease"}
            onPress={() => router.push({ pathname: "/home/[tenancyId]", params: { tenancyId: tenancy.tenantOrganisationId } })}
            testID={`home-${tenancy.tenantOrganisationId}`}
            last={index === tenancies.length - 1}
          />
        ))}
      </RowGroup>
    </View>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "N";
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
  homesError: { gap: spacing.sm },
  eyebrow: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, letterSpacing: 1.6, color: colors.gold },
  version: { textAlign: "center" },
});
