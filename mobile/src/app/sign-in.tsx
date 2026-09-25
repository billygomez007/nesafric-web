import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApi } from "@/api/provider";
import { signInErrorMessage } from "@/auth/errors";
import { useSession } from "@/auth/session";
import { AppText, Button, Notice, TextField } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const { signIn } = useSession();
  const { apiUrl } = useApi();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

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
    try {
      await signIn({ email: trimmed, password });
      setPassword("");
      // Opened from Account (normal) or directly via a link (nothing to go back to).
      if (router.canGoBack()) router.back();
      else router.replace("/account");
    } catch (error) {
      setFormError(signInErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <AppText variant="title">Sign in to NesAfric</AppText>
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
        <Button label="Create an account on nesafric.com" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/register`)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  center: { textAlign: "center" },
});
