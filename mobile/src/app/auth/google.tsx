import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { signInErrorMessage } from "@/auth/errors";
import { GOOGLE_REDIRECT_URL, GoogleSignInError } from "@/auth/google";
import { useSession } from "@/auth/session";
import { AppText, Button, Card } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

/**
 * Landing screen for `nesafric://auth/google`. On iOS the auth session captures the redirect
 * itself; on Android the same link also reaches the router, and if Android restarted the app while
 * the browser was open, this is the only copy. Either way the sign-in finishes through the session
 * provider (single use, state-checked), and this screen just steps out of the way.
 */
export default function GoogleRedirectScreen() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string; message?: string }>();
  const { completeGoogleRedirect } = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    // With the sign-in screen still underneath (the usual Android case), it shows the outcome of
    // the shared completion; this screen only steps back. After a restart there is nothing
    // underneath, so this screen reports the outcome itself.
    const underneath = router.canGoBack();
    const leave = () => (router.canGoBack() ? router.back() : router.replace("/account"));
    completeGoogleRedirect(`${GOOGLE_REDIRECT_URL}?${query}`)
      .then(leave)
      .catch((cause) => {
        if (underneath || (cause instanceof GoogleSignInError && cause.reason === "cancelled")) leave();
        else setError(signInErrorMessage(cause));
      });
  }, [params, completeGoogleRedirect]);

  return (
    <View style={styles.screen} testID="google-redirect">
      {error ? (
        <Card style={styles.card}>
          <AppText variant="label">Google sign-in didn’t finish</AppText>
          <AppText variant="caption">{error}</AppText>
          <Button label="Back to sign in" onPress={() => router.replace("/sign-in")} />
        </Card>
      ) : (
        <View accessibilityLabel="Finishing Google sign-in">
          <ActivityIndicator color={colors.brand} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { alignSelf: "stretch", gap: spacing.md },
});
