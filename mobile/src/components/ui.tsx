import { useState, type Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewProps } from "react-native";

import { colors, fonts, radii, spacing, type } from "@/theme/tokens";

export function AppText({ variant = "body", style, ...props }: TextProps & { variant?: keyof typeof type }) {
  return <Text {...props} style={[type[variant], style]} />;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "dark";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
};

/**
 * Pill buttons. Primary is NesAfric orange with a white label: use it for the one main action on a
 * screen. Secondary is white with a hairline border, ghost is text only, destructive is danger red
 * (never orange), dark is forest for saves inside workspace forms. Disabled turns grey; loading
 * keeps the variant's colour and shows a spinner, even when the button is also disabled.
 */
export function Button({ label, onPress, variant = "primary", loading = false, disabled = false, testID, accessibilityHint }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      // Loading wins over disabled: callers often set both from one busy flag, and the spinner
      // (drawn in the variant's label colour) must stay on the variant's own background to be seen.
      style={({ pressed }) => [styles.button, disabled && !loading ? styles.buttonDisabled : buttonVariants[variant](pressed && !loading)]}
    >
      {loading ? (
        <ActivityIndicator color={buttonText[variant]} />
      ) : (
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.buttonLabel, { color: disabled ? colors.disabledText : buttonText[variant] }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, (pressed: boolean) => object> = {
  primary: (pressed) => ({ backgroundColor: pressed ? colors.actionPressed : colors.action }),
  secondary: (pressed) => ({ backgroundColor: pressed ? colors.surface : colors.elevated, borderWidth: 1, borderColor: colors.hairline }),
  ghost: (pressed) => ({ backgroundColor: pressed ? colors.actionTint : "transparent" }),
  destructive: (pressed) => ({ backgroundColor: pressed ? colors.dangerPressed : colors.danger }),
  dark: (pressed) => ({ backgroundColor: pressed ? colors.forestDeep : colors.forest }),
};

const buttonText: Record<ButtonVariant, string> = { primary: colors.white, secondary: colors.ink, ghost: colors.action, destructive: colors.white, dark: colors.white };

/** Neutral border at rest, orange while focused, red on error (error always wins). */
export function TextField({ label, error, style, ref, onFocus, onBlur, ...props }: TextInputProps & { label: string; error?: string; ref?: Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.action}
        cursorColor={colors.action}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
        style={[styles.input, style, focused && styles.inputFocused, error ? { borderColor: colors.danger } : null]}
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
  inputFocused: { borderColor: colors.action },
  fieldError: { color: colors.danger, fontSize: 13 },
  card: { backgroundColor: colors.elevated, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, padding: spacing.lg, gap: spacing.xs },
  notice: { borderWidth: 1, borderRadius: radii.control, padding: spacing.md, backgroundColor: colors.elevated },
  state: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  center: { textAlign: "center" },
});
