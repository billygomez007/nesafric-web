import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  redeemTenantAccessCode,
  validateTenantAccessCode,
} from "@/api/tenant-access";
import { ApiError } from "@/api/client";
import { ACCOUNT_QUERY_KEY, useSession } from "@/auth/session";
import { AppText, Button, Notice, TextField } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

function messageForTenantAccessError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Your sign-in has ended. Sign in again before connecting your home.";
    }

    if (error.status === 429) {
      return "Too many access-code attempts. Please wait before trying again.";
    }

    if (
      error.code === "TENANT_ACCESS_INVALID" ||
      error.status === 404 ||
      error.status === 409 ||
      error.status === 422
    ) {
      return "This tenant access code is invalid or is no longer available.";
    }

    if (error.message) return error.message;
  }

  return "We couldn't verify this tenant access code. Check your connection and try again.";
}

export default function TenantAccessScreen() {
  const { api, user, status } = useSession();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;

    if (status !== "signedIn" || !user) {
      router.replace("/sign-in");
      return;
    }

    const value = code.trim();

    setFieldError(undefined);
    setFormError(null);

    if (value.length < 8 || value.length > 80) {
      setFieldError("Enter the tenant access code you received.");
      return;
    }

    setSubmitting(true);

    try {
      const validation = await validateTenantAccessCode(api, value);

      if (!validation.valid) {
        setFormError(
          "This tenant access code is invalid or is no longer available.",
        );
        return;
      }

      const redemption = await redeemTenantAccessCode(api, value);

      await queryClient.invalidateQueries({
        queryKey: [...ACCOUNT_QUERY_KEY, user.id, "tenancies"],
      });

      await queryClient.refetchQueries({
        queryKey: [...ACCOUNT_QUERY_KEY, user.id, "tenancies"],
        type: "active",
      });

      setCode("");

      router.replace({
        pathname: "/home/[tenancyId]",
        params: {
          tenancyId: redemption.tenantOrganisationId,
        },
      });
    } catch (error) {
      setFormError(messageForTenantAccessError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "signedOut") {
    return (
      <View style={[styles.centered, { paddingBottom: insets.bottom }]}>
        <AppText variant="heading" accessibilityRole="header">
          Sign in first
        </AppText>

        <AppText variant="body" style={styles.centerText}>
          Sign in to your NesAfric account before connecting a tenant access
          code.
        </AppText>

        <Button
          label="Sign in"
          onPress={() => router.replace("/sign-in")}
          testID="tenant-access-sign-in"
        />
      </View>
    );
  }

  if (status === "restoring") {
    return (
      <View style={[styles.centered, { paddingBottom: insets.bottom }]}>
        <AppText variant="body">Checking your sign-in…</AppText>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.xl + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <AppText
            variant="title"
            accessibilityRole="header"
            testID="tenant-access-title"
          >
            Connect your home
          </AppText>

          <AppText variant="body">
            Enter the tenant access code provided by your landlord or property
            manager.
          </AppText>

          <AppText variant="caption">
            The code securely connects this NesAfric account to the tenancy it
            was created for.
          </AppText>
        </View>

        {formError ? <Notice message={formError} /> : null}

        <TextField
          label="Tenant access code"
          value={code}
          onChangeText={(value) => {
            setCode(value);

            if (fieldError) setFieldError(undefined);
            if (formError) setFormError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          error={fieldError}
          testID="tenant-access-code"
        />

        <Button
          label="Connect my home"
          onPress={() => void submit()}
          loading={submitting}
          testID="tenant-access-submit"
        />

        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/account");
            }
          }}
          testID="tenant-access-cancel"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  intro: {
    gap: spacing.sm,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  centerText: {
    textAlign: "center",
  },
});
