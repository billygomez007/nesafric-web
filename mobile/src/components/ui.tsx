import type { Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewProps } from "react-native";

import { colors, fonts, radii, spacing, type } from "@/theme/tokens";

export function AppText({ variant = "body", style, ...props }: TextProps & { variant?: keyof typeof type }) {
  return <Text {...props} style={[type[variant], style]} />;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "dark";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

/** Pill buttons matching the web `buttonStyles`: primary is teal with ink text (never white, for
 * contrast), secondary is white with a hairline border, dark is forest with white text. */
export function Button({ label, onPress, variant = "primary", loading = false, disabled = false, testID }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, inactive ? styles.buttonDisabled : buttonVariants[variant](pressed)]}
    >
      {loading ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.buttonLabel, { color: inactive ? colors.disabledText : buttonText[variant] }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const buttonVariants = {
  primary: (pressed: boolean) => ({ backgroundColor: pressed ? colors.tealLight : colors.brand }),
  secondary: (pressed: boolean) => ({ backgroundColor: pressed ? colors.surface : colors.elevated, borderWidth: 1, borderColor: colors.hairline }),
  dark: (pressed: boolean) => ({ backgroundColor: pressed ? colors.forestDeep : colors.forest }),
};

const buttonText = { primary: colors.ink, secondary: colors.ink, dark: colors.white };

export function TextField({ label, error, style, ref, ...props }: TextInputProps & { label: string; error?: string; ref?: Ref<TextInput> }) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, style, error ? { borderColor: colors.danger } : null]}
      />
      {error ? <AppText style={styles.fieldError}>{error}</AppText> : null}
    </View>
  );
}

export function Card({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.card, style]} />;
}

export function Notice({ tone = "danger", message }: { tone?: "danger" | "warning" | "info"; message: string }) {
  const color = tone === "danger" ? colors.danger : tone === "warning" ? colors.warning : colors.brandStrong;
  return (
    <View accessibilityRole="alert" style={[styles.notice, { borderColor: color }]}>
      <AppText style={{ color }}>{message}</AppText>
    </View>
  );
}

export function StateMessage({ title, message, actionLabel, onAction }: { title: string; message?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.state}>
      <AppText variant="heading" style={styles.center}>{title}</AppText>
      {message ? <AppText variant="caption" style={styles.center}>{message}</AppText> : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} /> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={colors.brand} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: radii.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  buttonDisabled: { backgroundColor: colors.disabledBackground },
  buttonLabel: { fontFamily: fonts.bold, fontSize: 15 },
  field: { gap: spacing.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.field,
    backgroundColor: colors.elevated,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.ink,
  },
  fieldError: { color: colors.danger, fontSize: 13 },
  card: { backgroundColor: colors.elevated, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, padding: spacing.lg, gap: spacing.xs },
  notice: { borderWidth: 1, borderRadius: radii.control, padding: spacing.md, backgroundColor: colors.elevated },
  state: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  center: { textAlign: "center" },
});
