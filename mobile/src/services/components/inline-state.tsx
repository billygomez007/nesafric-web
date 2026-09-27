import { ActivityIndicator, StyleSheet, View } from "react-native";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { AppText, Button } from "@/components/ui";
import { colors, radii, spacing } from "@/theme/tokens";

/** Loading / error / empty state sized for a section inside a scrolling screen. */
export function InlineState({
  loading = false,
  error,
  emptyTitle,
  emptyMessage,
  onRetry,
  actionLabel,
  onAction,
  testID,
}: {
  loading?: boolean;
  error?: unknown;
  emptyTitle?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  if (loading) {
    return (
      <View style={styles.box} testID={testID}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (error) {
    const offline = error instanceof ApiError && error.code === NETWORK_ERROR;
    return (
      <View style={styles.box} testID={testID} accessibilityRole="alert">
        <AppText variant="label" style={styles.center}>{offline ? "You're offline" : "Couldn't load this"}</AppText>
        <AppText variant="caption" style={styles.center}>{error instanceof Error ? error.message : "Something went wrong."}</AppText>
        {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }
  return (
    <View style={styles.box} testID={testID}>
      {emptyTitle ? <AppText variant="label" style={styles.center}>{emptyTitle}</AppText> : null}
      {emptyMessage ? <AppText variant="caption" style={styles.center}>{emptyMessage}</AppText> : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.shell,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  center: { textAlign: "center" },
});
