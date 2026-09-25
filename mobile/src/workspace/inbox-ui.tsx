import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useWorkspaces } from "@/api/account-queries";
import type { PreferredTime } from "@/api/inbox";
import { useActiveWorkspace } from "@/api/inbox-queries";
import { useSession } from "@/auth/session";
import { isListedOrganisation } from "@/auth/workspaces";
import { AppText, Button, Loading, Notice, StateMessage } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { usableEmail, usablePhone } from "./contact";

/**
 * Every workspace screen goes through this: signed out → sign-in prompt; organisation not in the
 * server's own workspace list → "not available" (and no request carrying its id is ever sent).
 * Entering a workspace drops cached inbox data of any other workspace.
 */
export function useWorkspaceGate(organisationId: string | undefined) {
  const { status } = useSession();
  const workspaces = useWorkspaces();
  const listed = isListedOrganisation(workspaces.data, organisationId);
  const scopedId = listed && organisationId ? organisationId : null;
  useActiveWorkspace(scopedId);
  const organisation = workspaces.data?.propertyOsOrganisations.find((item) => item.id === organisationId);

  let gate: ReactNode = null;
  if (status !== "signedIn") {
    gate = <StateMessage title="Sign in to see this workspace" actionLabel="Sign in" onAction={() => router.replace("/sign-in")} />;
  } else if (workspaces.isPending) {
    gate = <Loading />;
  } else if (!listed) {
    gate = (
      <StateMessage
        title="Workspace not available"
        message="You’re not a member of this workspace, or it’s no longer available to you."
        actionLabel="Back to Account"
        onAction={() => (router.canGoBack() ? router.back() : router.replace("/account"))}
      />
    );
  }
  return { gate, organisationId: scopedId, organisation };
}

const STATUS_TONE: Record<string, string> = {
  NEW: colors.brandStrong,
  REQUESTED: colors.brandStrong,
  CONFIRMED: colors.success,
  COMPLETED: colors.success,
  CLOSED: colors.muted,
  LOST: colors.muted,
  CANCELLED: colors.muted,
  NO_SHOW: colors.warning,
  RESCHEDULED: colors.warning,
};

export function StatusPill({ status }: { status: string }) {
  const color = STATUS_TONE[status] ?? colors.forest;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <AppText style={[styles.pillText, { color }]}>{humanise(status)}</AppText>
    </View>
  );
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
  try {
    return date.toLocaleString("en-GB", timeZone ? { ...options, timeZone } : options);
  } catch {
    return date.toLocaleString("en-GB", options); // unknown time zone name
  }
}

export function formatWindow(time: PreferredTime) {
  const start = formatDateTime(time.startsAt, time.timezone);
  const end = new Date(time.endsAt);
  if (!start || Number.isNaN(end.getTime())) return start ?? "";
  let endLabel: string;
  try {
    endLabel = end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: time.timezone });
  } catch {
    endLabel = end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return `${start}–${endLabel} (${time.timezone})`;
}

/** Confirmed time if there is one, otherwise the first preferred window. */
export function viewingWhen(viewing: { confirmedStartsAt: string | null; preferredTimes: PreferredTime[] }) {
  if (viewing.confirmedStartsAt) return `Confirmed · ${formatDateTime(viewing.confirmedStartsAt)}`;
  const first = viewing.preferredTimes[0];
  return first ? `Preferred · ${formatWindow(first)}` : "No time requested";
}

/**
 * Call / Email, shown only for a usable phone number or email address from the authorised
 * response. Opens the phone or mail app directly, like the rest of the app (iOS asks before placing
 * a call; Android opens the dialer without dialling).
 */
export function ContactActions({ name, phone, email }: { name: string; phone: string | null; email: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const tel = usablePhone(phone);
  const mail = usableEmail(email);
  const open = (url: string, app: string) => Linking.openURL(url).then(() => setFailed(null), () => setFailed(app));

  if (!tel && !mail) {
    return (
      <AppText variant="caption" testID="no-contact">
        No usable phone number or email address was shared with this request.
      </AppText>
    );
  }
  return (
    <View style={styles.contact}>
      {tel ? (
        <View style={styles.contactRow}>
          <Ionicons name="call-outline" size={18} color={colors.forest} />
          <AppText style={styles.contactValue} selectable>
            {phone}
          </AppText>
        </View>
      ) : null}
      {mail ? (
        <View style={styles.contactRow}>
          <Ionicons name="mail-outline" size={18} color={colors.forest} />
          <AppText style={styles.contactValue} selectable>
            {mail}
          </AppText>
        </View>
      ) : null}
      <View style={styles.contactButtons}>
        {tel ? (
          <View style={styles.flex}>
            <Button label={`Call ${firstName(name)}`} onPress={() => void open(`tel:${tel}`, "phone")} testID="contact-call" />
          </View>
        ) : null}
        {mail ? (
          <View style={styles.flex}>
            <Button label="Email" variant="secondary" onPress={() => void open(`mailto:${mail}`, "email")} testID="contact-email" />
          </View>
        ) : null}
      </View>
      {failed ? <Notice message={`Couldn’t open your ${failed} app on this device.`} /> : null}
    </View>
  );
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "";
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label" accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

export function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <AppText variant="caption">{label}</AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

export function Timeline({ history }: { history: { id: string; fromStatus: string | null; toStatus: string; createdAt: string }[] }) {
  if (history.length === 0) return <AppText variant="caption">No status changes yet.</AppText>;
  return (
    <View style={styles.timeline}>
      {history.map((entry) => (
        <View key={entry.id} style={styles.timelineRow}>
          <View style={styles.dot} />
          <View style={styles.flex}>
            <AppText variant="label">{entry.fromStatus ? `${humanise(entry.fromStatus)} → ${humanise(entry.toStatus)}` : humanise(entry.toStatus)}</AppText>
            <AppText variant="caption">{formatDateTime(entry.createdAt)}</AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  contact: { gap: spacing.sm },
  contactRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  contactValue: { flex: 1 },
  contactButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  section: { gap: spacing.sm, backgroundColor: colors.elevated, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, padding: spacing.lg },
  sectionTitle: { color: colors.forest },
  fact: { gap: 2 },
  timeline: { gap: spacing.md },
  timelineRow: { flexDirection: "row", gap: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold, marginTop: 5 },
});
