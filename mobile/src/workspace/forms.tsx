import { useQueryClient } from "@tanstack/react-query";
import { Children, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { Chip } from "@/components/chip";
import { AppText, Loading, Notice, StateMessage } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import { workspaceCacheKey, type GateKind } from "./inbox-ui";

/** Scrollable form body that stays clear of the keyboard and the home indicator. */
export function FormScreen({ children, testID }: { children: ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView testID={testID} contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A titled group of fields. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {hint ? <AppText variant="caption">{hint}</AppText> : null}
      {children}
    </View>
  );
}

/** Single choice from a short list, as chips. `allowNone` lets the selected chip be cleared. */
export function ChoiceField<T extends string>({ label, options, value, onChange, error, testID }: { label: string; options: readonly (readonly [T, string])[]; value: T | ""; onChange: (value: T) => void; error?: string; testID?: string }) {
  return (
    <View style={styles.field} testID={testID} accessibilityLabel={label}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.chips}>
        {options.map(([option, text]) => (
          <Chip key={option || "none"} label={text} selected={value === option} onPress={() => onChange(option)} />
        ))}
      </View>
      {error ? <AppText style={styles.error}>{error}</AppText> : null}
    </View>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{Children.map(children, (child) => <View style={styles.cell}>{child}</View>)}</View>;
}

/**
 * The server's refusal, word for word: validation issues (first few) or its message. A 403 means
 * the role in this workspace does not allow the action — the app never works around that.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Your role in this workspace doesn’t allow this. Ask an administrator for access.";
    if (error.issues.length) return error.issues.slice(0, 4).map((issue) => issue.message).join("\n");
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Loading and error state for a workspace record (listing, property, unit, tenant). A 404 means the
 * record is not in this workspace — including one that belongs to someone else.
 */
export function RecordState({ noun, query }: { noun: string; query: { isPending: boolean; error: unknown; refetch: () => unknown } }) {
  if (query.isPending) return <Loading />;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return <StateMessage title={`This ${noun} isn’t available`} message="Not found in this workspace. It may have been removed, or it belongs to another account." />;
  }
  return <StateMessage title={`Couldn’t load this ${noun}`} message={describeError(query.error)} actionLabel="Try again" onAction={() => void query.refetch()} />;
}

export function FormError({ error }: { error: unknown }) {
  return error ? <Notice message={describeError(error)} /> : null;
}

/** Refetches every cached screen of one workspace after a change (lists, details, dashboard). */
export function useInvalidateWorkspace(kind: GateKind, id: string | null) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  return () => (id ? queryClient.invalidateQueries({ queryKey: [...ACCOUNT_QUERY_KEY, user?.id, "ws", workspaceCacheKey(kind, id)] }) : Promise.resolve());
}

/** "2026-10-01" style date typed on a phone; null when not a real calendar date. */
export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.xl },
  section: { gap: spacing.md },
  field: { gap: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.md },
  cell: { flex: 1 },
  error: { color: colors.danger, fontSize: 13 },
});
