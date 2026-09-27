import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { useSavedProviders, useToggleSavedProvider } from "@/api/service-queries";
import type { PublicProvider } from "@/api/types";
import { useSession } from "@/auth/session";
import { AppText } from "@/components/ui";
import { colors, fonts } from "@/theme/tokens";

function saveErrorMessage(error: unknown, saving: boolean) {
  if (error instanceof ApiError && error.status === 404) return "This provider is no longer listed.";
  if (error instanceof ApiError && error.code === NETWORK_ERROR) return "You're offline. Try again.";
  return saving ? "Couldn’t save. Try again." : "Couldn’t remove. Try again.";
}

/**
 * Heart for saving a provider to the signed-in account. Signed out, it opens the existing sign-in
 * modal (which returns here). The heart only fills once the server has accepted the save, and a
 * refusal is shown next to it instead of a saved state.
 */
export function SaveProviderButton({ provider }: { provider: PublicProvider | { id: string; displayName: string } }) {
  const { status } = useSession();
  const saved = useSavedProviders();
  const toggle = useToggleSavedProvider();
  const isSaved = Boolean(saved.data?.items.some((item) => item.providerId === provider.id));
  const busy = toggle.isPending || (status === "signedIn" && saved.isPending);
  const failedFor = toggle.isError && toggle.variables?.provider.id === provider.id ? toggle.variables.save : null;

  function press() {
    if (status === "signedOut") {
      router.push("/sign-in");
      return;
    }
    if (status !== "signedIn" || busy) return;
    toggle.mutate({ provider, save: !isSaved });
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isSaved ? `Remove ${provider.displayName} from saved` : `Save ${provider.displayName}`}
        accessibilityState={{ selected: isSaved, busy, disabled: status === "restoring" || busy }}
        hitSlop={8}
        onPress={press}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        testID={`save-provider-${provider.id}`}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.forest} />
        ) : (
          <Ionicons name={isSaved ? "heart" : "heart-outline"} size={22} color={isSaved ? colors.danger : colors.forestDeep} />
        )}
      </Pressable>
      {failedFor !== null ? (
        <AppText accessibilityRole="alert" style={styles.error}>
          {saveErrorMessage(toggle.error, failedFor)}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", maxWidth: 150, gap: 2 },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: { backgroundColor: colors.surface },
  error: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.danger, textAlign: "right" },
});
