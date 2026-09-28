import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { requestOtp, type OtpChallenge, type OtpChannel, type OtpMode } from "@/api/account";
import { ApiError } from "@/api/client";
import { signInErrorMessage } from "@/auth/errors";
import { GoogleSignInError } from "@/auth/google";
import { useSession } from "@/auth/session";
import { AppText, Button, Notice, TextField } from "@/components/ui";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { requestPostSignInRouting } from "@/workspace/navigator";
import { parseIntent } from "@/workspace/resolve";
import type { SignInIntent } from "@/workspace/routing";

/**
 * Wording for each entry point. The card a person tapped changes only this text and where the app
 * goes next; what the account may open is decided by the server after sign-in.
 */
const ENTRY: Record<SignInIntent, { title: string; lead: string }> = {
  customer: { title: "Sign in to NesAfric", lead: "Save properties, manage your enquiries and keep track of viewings." },
  tenant: {
    title: "Continue as Tenant",
    lead: "Sign in to see the home you rent, your lease, payments, repairs and messages. If your landlord gave you a tenant access code, you can connect it after signing in.",
  },
  property_management: { title: "Continue as Landlord / Property Manager", lead: "Sign in to open your property management workspace, or set one up." },
  professional: { title: "Continue as Real Estate Professional", lead: "Sign in to open your professional workspace, or register your business." },
  service_provider: { title: "Continue as Service Provider", lead: "Sign in to open your service provider workspace, or register your business." },
};

type Step = "identifier" | "code" | "noAccount";

/**
 * Passwordless sign-in and sign-up, native on Android and iOS: a one-time code by text message or
 * email, or Google. Receiving an SMS needs no permission: the code field uses the platforms' own
 * one-time-code autofill (iOS `oneTimeCode`, Android `sms-otp`), never SMS read access.
 */
export default function SignInScreen() {
  const { api, signInWithCode, signInWithGoogle } = useSession();
  const params = useLocalSearchParams<{ intent?: string; mode?: string }>();
  // Only changes the wording; what the account can open is decided by the server after sign-in.
  const intent = parseIntent(params.intent);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<OtpMode>(params.mode === "register" ? "register" : "login");
  const [channel, setChannel] = useState<OtpChannel>("sms");
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | "google" | null>(null);
  const busyRef = useRef(false);
  const codeRef = useRef<TextInput>(null);
  const entry = ENTRY[intent ?? "customer"];
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  function leave() {
    // Opened from Account (normal) or directly via a link (nothing to go back to).
    if (router.canGoBack()) router.back();
    else router.replace("/account");
  }

  async function run(kind: "send" | "verify" | "google", work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setFormError(null);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function reset(next: { mode?: OtpMode; channel?: OtpChannel }) {
    if (next.mode) setMode(next.mode);
    if (next.channel && next.channel !== channel) {
      setChannel(next.channel);
      setIdentifier("");
    }
    setStep("identifier");
    setChallenge(null);
    setCode("");
    setFormError(null);
    setNotice(null);
  }

  const continueWithGoogle = () =>
    run("google", async () => {
      // Same post-sign-in routing as a code: the server's workspaces decide.
      requestPostSignInRouting(intent ?? "customer");
      try {
        await signInWithGoogle();
        leave();
      } catch (error) {
        requestPostSignInRouting(null);
        // Closing the Google window is a choice, not an error.
        if (!(error instanceof GoogleSignInError && error.reason === "cancelled")) setFormError(signInErrorMessage(error));
      }
    });

  const sendCode = () =>
    run("send", async () => {
      if (mode === "register" && displayName.trim().length < 2) {
        setFormError("Enter your name (at least 2 characters).");
        return;
      }
      if (!identifier.trim()) {
        setFormError(channel === "sms" ? "Enter your mobile number." : "Enter your email address.");
        return;
      }
      try {
        const sent = await requestOtp(api, { mode, channel, identifier: identifier.trim() });
        setChallenge(sent);
        setCode("");
        setResendAt(Date.now() + sent.resendAfterSeconds * 1000);
        setNow(Date.now());
        const minutes = Math.round((Date.parse(sent.expiresAt) - Date.now()) / 60_000);
        setNotice(`We sent a 6-digit code to ${sent.destination}.${Number.isFinite(minutes) && minutes > 0 ? ` It expires in ${minutes} minute${minutes === 1 ? "" : "s"}.` : ""}`);
        setStep("code");
        setTimeout(() => codeRef.current?.focus(), 0);
      } catch (error) {
        setFormError(signInErrorMessage(error));
      }
    });

  const verify = (withName: boolean) =>
    run("verify", async () => {
      if (!challenge) return;
      if (code.length !== 6) {
        setFormError("Enter the 6-digit code.");
        return;
      }
      requestPostSignInRouting(intent ?? "customer");
      try {
        await signInWithCode({
          challengeId: challenge.challengeId,
          channel,
          identifier: identifier.trim(),
          code,
          ...(withName ? { displayName: displayName.trim() } : {}),
        });
        setCode("");
        leave();
      } catch (error) {
        requestPostSignInRouting(null);
        if (error instanceof ApiError && error.code === "OTP_NO_ACCOUNT") {
          // Possession of the address is proven: say so, and offer to create the account with it.
          setNotice(error.message);
          setStep("noAccount");
          return;
        }
        setFormError(signInErrorMessage(error));
      }
    });

  const phone = channel === "sms";
  const disabled = busy !== null;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <AppText variant="title" accessibilityRole="header" testID="sign-in-title">
          {mode === "register" ? "Create your NesAfric account" : entry.title}
        </AppText>
        <AppText variant="label" testID="sign-in-intent">
          {entry.lead}
        </AppText>

        <Segmented
          testID="sign-in-mode"
          value={mode}
          options={[{ value: "login", label: "Sign in" }, { value: "register", label: "Create account" }]}
          onChange={(value) => reset({ mode: value })}
          disabled={disabled}
        />

        {formError ? <Notice message={formError} /> : null}

        <Pressable
          testID="sign-in-google"
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled, busy: busy === "google" }}
          disabled={disabled}
          onPress={continueWithGoogle}
          style={({ pressed }) => [styles.google, pressed && styles.googlePressed]}
        >
          {busy === "google" ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <>
              <MaterialCommunityIcons name="google" size={20} color={colors.ink} />
              <AppText style={styles.googleLabel}>Continue with Google</AppText>
            </>
          )}
        </Pressable>
        <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.rule} />
          <AppText variant="caption">or</AppText>
          <View style={styles.rule} />
        </View>

        <Segmented
          testID="sign-in-method"
          value={channel}
          options={[{ value: "sms", label: "Phone" }, { value: "email", label: "Email" }]}
          onChange={(value) => reset({ channel: value })}
          disabled={disabled}
        />

        {step === "identifier" ? (
          <>
            {mode === "register" ? (
              <TextField label="Your name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={100} testID="sign-up-name" />
            ) : null}
            {phone ? (
              <TextField
                label="Mobile number"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="024 123 4567"
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="send"
                onSubmitEditing={sendCode}
                testID="sign-in-phone"
              />
            ) : (
              <TextField
                label="Email"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={sendCode}
                testID="sign-in-email"
              />
            )}
            {phone ? <AppText variant="caption">Ghana numbers can start with 0. For other countries, start with + and the country code.</AppText> : null}
            <Button label="Send code" onPress={sendCode} loading={busy === "send"} disabled={disabled} testID="sign-in-send-code" />
            <AppText variant="caption" style={styles.center}>
              {phone ? "We’ll text you a 6-digit code." : "We’ll email you a 6-digit code."} No password needed.
            </AppText>
          </>
        ) : null}

        {step === "code" && challenge ? (
          <>
            {notice ? (
              <AppText variant="caption" accessibilityLiveRegion="polite" testID="sign-in-code-sent">
                {notice}
              </AppText>
            ) : null}
            <TextField
              ref={codeRef}
              label="6-digit code"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
              textContentType="oneTimeCode"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => verify(mode === "register")}
              style={styles.code}
              testID="sign-in-code"
            />
            <Button
              label={mode === "register" ? "Verify & create account" : "Verify & sign in"}
              onPress={() => verify(mode === "register")}
              loading={busy === "verify"}
              disabled={disabled}
              testID="sign-in-verify"
            />
            <View style={styles.row}>
              <Pressable accessibilityRole="button" onPress={() => reset({})} disabled={disabled} hitSlop={8}>
                <AppText style={styles.link}>{phone ? "Change number" : "Change email"}</AppText>
              </Pressable>
              {secondsLeft > 0 ? (
                <AppText variant="caption" accessibilityLabel="You can request a new code in about a minute">
                  Resend in {secondsLeft}s
                </AppText>
              ) : (
                <Pressable accessibilityRole="button" onPress={sendCode} disabled={disabled} hitSlop={8} testID="sign-in-resend">
                  <AppText style={styles.link}>Resend code</AppText>
                </Pressable>
              )}
            </View>
          </>
        ) : null}

        {step === "noAccount" ? (
          <>
            {notice ? <Notice tone="info" message={notice} /> : null}
            <TextField label="Your name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={100} testID="no-account-name" />
            <Button
              label="Create account"
              onPress={() => (displayName.trim().length < 2 ? setFormError("Enter your name (at least 2 characters).") : verify(true))}
              loading={busy === "verify"}
              disabled={disabled}
              testID="no-account-create"
            />
            <Button label={`Use ${phone ? "email" : "a phone number"} instead`} variant="secondary" onPress={() => reset({ channel: phone ? "email" : "sms" })} disabled={disabled} />
          </>
        ) : null}

        <AppText variant="caption" style={styles.center}>
          The same account works on nesafric.com. You can keep browsing properties without signing in.
        </AppText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled, testID }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; testID?: string }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist" testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => !selected && onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
            testID={`${testID}-${option.value}`}
          >
            <AppText style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  center: { textAlign: "center" },
  google: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  googlePressed: { backgroundColor: colors.surface },
  googleLabel: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  segmented: { flexDirection: "row", padding: 4, gap: 4, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface },
  segment: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  segmentSelected: { backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.hairline },
  segmentLabel: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.muted },
  segmentLabelSelected: { color: colors.ink },
  code: { fontSize: 22, letterSpacing: 8, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.brandStrong },
});
