import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/api/provider";
import { signInErrorMessage } from "@/auth/errors";
import { useSession } from "@/auth/session";
import { AppText, Button, Notice, TextField } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import { requestPostSignInRouting } from "@/workspace/navigator";
import { parseIntent, type WorkspaceIntent } from "@/workspace/resolve";
import { registerPath } from "@/workspace/routing";

/**
 * Wording for each entry point. The card a person tapped changes only this text and where the app
 * goes next; what the account may open is decided by the server after sign-in.
 */
const ENTRY: Record<WorkspaceIntent | "customer", { title: string; lead: string; register: string }> = {
  customer: {
    title: "Sign in to NesAfric",
    lead: "Save properties, manage your enquiries and keep track of viewings.",
    register: "Create an account",
  },
  property_management: {
    title: "Continue as Landlord / Property Manager",
    lead: "Sign in to open your property management workspace, or set one up.",
    register: "Create / Set up property management account",
  },
  professional: {
    title: "Continue as Real Estate Professional",
    lead: "Sign in to open your professional workspace, or register your business.",
    register: "Register as a Real Estate Professional",
  },
  service_provider: {
    title: "Continue as Service Provider",
    lead: "Sign in to open your service provider workspace, or register your business.",
    register: "Register as a Service Provider",
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const { signIn } = useSession();
  // Only changes the wording; what the account can open is decided by the server after sign-in.
  const intent = parseIntent(useLocalSearchParams<{ intent?: string }>().intent);
  const { apiUrl } = useApi();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const entry = ENTRY[intent ?? "customer"];

  async function submit() {
    if (submitting) return;
    const trimmed = email.trim();
    const errors = {
      email: EMAIL.test(trimmed) ? undefined : "Enter the email address you use for NesAfric.",
      password: password ? undefined : "Enter your password.",
    };
    setFieldError(errors);
    setFormError(null);
    if (errors.email || errors.password) return;
    setSubmitting(true);
    // Decided before the session exists so the navigator sees it as soon as the account's
    // workspaces load; cleared again if sign-in fails.
    requestPostSignInRouting(intent ?? "customer");
    try {
      await signIn({ email: trimmed, password });
      setPassword("");
      // Opened from Account (normal) or directly via a link (nothing to go back to).
      if (router.canGoBack()) router.back();
      else router.replace("/account");
    } catch (error) {
      requestPostSignInRouting(null);
      setFormError(signInErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <AppText variant="title" accessibilityRole="header" testID="sign-in-title">
          {entry.title}
        </AppText>
        <AppText variant="label" testID="sign-in-intent">
          {entry.lead}
        </AppText>
        <AppText variant="caption">
          Use the same NesAfric account as the website. You can keep browsing properties without signing in.
        </AppText>
        {formError ? <Notice message={formError} /> : null}
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          error={fieldError.email}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={fieldError.password}
        />
        <Button label="Sign in" onPress={submit} loading={submitting} testID="sign-in-submit" />
        <AppText variant="caption" style={styles.center}>
          New to NesAfric?
        </AppText>
        <Button
          label={entry.register}
          variant="secondary"
          accessibilityHint="Opens nesafric.com"
          testID="sign-in-register"
          onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}${registerPath(intent ?? "customer")}`)}
        />
        <AppText variant="caption" style={styles.center}>
          Registration opens nesafric.com. Come back and sign in here with the same account.
        </AppText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  center: { textAlign: "center" },
});
