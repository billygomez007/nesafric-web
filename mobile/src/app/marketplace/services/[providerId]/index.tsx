import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { useMarketplaceProvider } from "@/api/service-queries";
import type { PublicProvider } from "@/api/types";
import { QueryState } from "@/components/query-state";
import { AppText, Button, StateMessage, TextField } from "@/components/ui";
import { SaveProviderButton } from "@/services/components/save-provider-button";
import {
  AvailabilityPill,
  ProviderAvatar,
  VerificationBadges,
} from "@/services/components/trust";
import {
  formatArea,
  formatCompletionRate,
  formatRating,
  formatResponseTime,
  formatStartingRate,
  providerTypeLabel,
} from "@/services/format";
import { openProviderSearch, openRequestService } from "@/services/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { rateMarketplaceProvider } from "@/api/services";
import { useSession } from "@/auth/session";
import { useApi } from "@/api/provider";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Public service provider profile. Accepts the provider id, or the website's profile slug so a
 * shared `/marketplace/services/<slug>` link opens the same profile.
 */

function CustomerRatingPanel({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const router = useRouter();
  const { api } = useApi();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitRating() {
    if (status !== "signedIn") {
      router.push("/sign-in");
      return;
    }

    if (!score || submitting) return;

    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      await rateMarketplaceProvider(api, providerId, {
        score,
        comment: comment.trim() || undefined,
      });

      setMessage("Thanks. Your rating has been saved.");
      await queryClient.invalidateQueries({
        queryKey: ["marketplace", "provider"],
      });
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === "CLOSED_MARKETPLACE_ENQUIRY_REQUIRED"
      ) {
        setError(
          "You can rate this provider after your service request with them is closed.",
        );
      } else if (
        cause instanceof ApiError &&
        cause.code === "PROVIDER_SELF_RATING_NOT_ALLOWED"
      ) {
        setError("You cannot rate your own service provider profile.");
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : "Your rating could not be saved. Please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "signedOut") {
    return (
      <Section title="Rate this provider">
        <AppText variant="caption">
          Sign in to rate {providerName}. Ratings are available after a
          marketplace service request is closed.
        </AppText>
        <Button
          label="Sign in to rate"
          onPress={() => router.push("/sign-in")}
          testID="provider-rating-sign-in"
        />
      </Section>
    );
  }

  return (
    <Section title="Rate this provider">
      <AppText variant="caption">
        Choose a rating from 1 to 5 stars. You can update your rating later.
      </AppText>

      <View
        style={styles.ratingStars}
        accessibilityLabel="Provider rating"
        testID="provider-rating-stars"
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
            accessibilityState={{ selected: score === value }}
            onPress={() => {
              setScore(value);
              setMessage(null);
              setError(null);
            }}
            style={styles.ratingStarButton}
            testID={`provider-rating-${value}`}
          >
            <MaterialCommunityIcons
              name={score !== null && value <= score ? "star" : "star-outline"}
              size={30}
              color={colors.forestDeep}
            />
          </Pressable>
        ))}
      </View>

      <TextField
        label="Comment (optional)"
        value={comment}
        onChangeText={setComment}
        placeholder="Share your experience with this provider"
        multiline
        maxLength={5000}
        testID="provider-rating-comment"
      />

      {error ? (
        <AppText variant="caption" style={styles.ratingError}>
          {error}
        </AppText>
      ) : null}

      {message ? (
        <AppText variant="caption" style={styles.ratingSuccess}>
          {message}
        </AppText>
      ) : null}

      <Button
        label={submitting ? "Saving…" : "Submit rating"}
        onPress={submitRating}
        disabled={!score || submitting}
        testID="submit-provider-rating"
      />
    </Section>
  );
}

export default function ProviderProfileScreen() {
  const { providerId } = useLocalSearchParams<{ providerId: string }>();
  const query = useMarketplaceProvider(providerId);
  const provider = query.data?.provider;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: provider?.displayName ?? "",
          headerRight: provider
            ? () => <SaveProviderButton provider={provider} />
            : undefined,
        }}
      />
      {provider ? (
        <ProviderProfile provider={provider} />
      ) : query.error instanceof ApiError && query.error.status === 404 ? (
        <StateMessage
          title="Provider no longer listed"
          message="This provider isn't on the NesAfric marketplace right now. Their profile may have been unlisted or is under review."
          actionLabel="Browse service providers"
          onAction={() => openProviderSearch()}
        />
      ) : (
        <QueryState
          isPending={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
        />
      )}
    </View>
  );
}

function ProviderProfile({ provider }: { provider: PublicProvider }) {
  const insets = useSafeAreaInsets();
  const type = providerTypeLabel(provider.type);
  const rating = formatRating(provider);
  const rate = formatStartingRate(provider);
  const response = formatResponseTime(provider.responseTimeHours);
  const firstCategory = provider.categories[0]?.id;
  // Server-computed only; shown as a whole percentage, never derived here.
  const completion = formatCompletionRate(provider)
    ? Math.round((provider.completionRate as number) * 100)
    : null;
  const notTakingWork =
    provider.verification !== "VERIFIED" ||
    !provider.acceptingWork ||
    provider.availability === "UNAVAILABLE";

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: 140 + insets.bottom },
        ]}
      >
        <View style={styles.identity}>
          <ProviderAvatar
            name={provider.displayName}
            logoUrl={provider.logo?.url}
            size={68}
          />
          <View style={styles.identityText}>
            <AppText accessibilityRole="header" style={styles.name}>
              {provider.displayName}
            </AppText>
            <AppText style={styles.meta}>
              {[type, provider.categories[0]?.name].filter(Boolean).join(" · ")}
            </AppText>
            <AvailabilityPill provider={provider} />
          </View>
        </View>
        <VerificationBadges provider={provider} />

        <Section title="NesAfric record">
          <View style={styles.stats}>
            <Stat
              testID="stat-rating"
              value={rating ? rating.score : "—"}
              label={rating ? rating.count : "No ratings yet"}
              icon="star"
            />
            <Stat
              testID="stat-jobs"
              value={provider.completedJobs.toLocaleString()}
              label={
                provider.completedJobs === 1
                  ? "job completed"
                  : "jobs completed"
              }
              icon="checkmark-done"
            />
            {completion !== null ? (
              <Stat
                testID="stat-completion"
                value={`${completion}%`}
                label="completion rate"
                icon="checkmark-circle"
              />
            ) : null}
          </View>
          {completion !== null && provider.completionRateBasis ? (
            <AppText variant="caption">
              Completion rate covers the{" "}
              {provider.completionRateBasis.toLocaleString()} jobs this provider
              accepted that have since finished.
            </AppText>
          ) : null}
        </Section>

        {provider.description ? (
          <Section title="About">
            <AppText>{provider.description}</AppText>
          </Section>
        ) : null}

        {provider.categories.length ? (
          <Section title="Services">
            <View style={styles.tags}>
              {provider.categories.map((category) => (
                <View key={category.id} style={styles.tag}>
                  <AppText style={styles.tagText}>{category.name}</AppText>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {provider.serviceAreas.length ? (
          <Section title="Areas served">
            {provider.serviceAreas.map((area, index) => (
              <View key={`${area.countryCode}-${index}`} style={styles.inline}>
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={colors.muted}
                />
                <AppText>{formatArea(area)}</AppText>
              </View>
            ))}
          </Section>
        ) : null}

        {rate || response ? (
          <Section title="From the provider">
            {rate ? <Fact label="Starting rate" value={rate} /> : null}
            {response ? (
              <Fact label="Stated response time" value={response} />
            ) : null}
            <AppText variant="caption">
              Set by the provider. Ask for a quote for your exact job.
            </AppText>
          </Section>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: spacing.md + insets.bottom }]}>
        {notTakingWork ? (
          <AppText variant="caption" style={styles.center}>
            This provider isn’t taking new work right now and may not respond.
          </AppText>
        ) : null}
        <CustomerRatingPanel
          providerId={provider.id}
          providerName={provider.displayName}
        />

        {!notTakingWork ? (
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                label="Get quote"
                variant="secondary"
                onPress={() =>
                  openRequestService(provider.id, firstCategory, true)
                }
              />
            </View>
            <View style={styles.action}>
              <Button
                label="Request service"
                onPress={() => openRequestService(provider.id, firstCategory)}
                testID="profile-request-service"
              />
            </View>
          </View>
        ) : provider.verification !== "VERIFIED" ? (
          <AppText variant="caption" style={styles.center}>
            Verification is required before this provider can receive service
            requests.
          </AppText>
        ) : null}
      </View>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="heading">{title}</AppText>
      {children}
    </View>
  );
}

function Stat({
  value,
  label,
  icon,
  testID,
}: {
  value: string;
  label: string;
  icon: "star" | "checkmark-done" | "checkmark-circle";
  testID: string;
}) {
  return (
    <View style={styles.stat} testID={testID}>
      <View style={styles.inline}>
        <Ionicons
          name={icon}
          size={16}
          color={icon === "star" ? colors.gold : colors.brandStrong}
        />
        <AppText style={styles.statValue}>{value}</AppText>
      </View>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="label">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  ratingStars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingStarButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingError: {
    color: colors.danger,
  },
  ratingSuccess: {
    color: colors.forestDeep,
  },

  screen: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, gap: spacing.xl },
  identity: { flexDirection: "row", gap: spacing.lg, alignItems: "center" },
  identityText: { flex: 1, gap: 4 },
  name: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
    color: colors.forestDeep,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.muted,
  },
  section: { gap: spacing.sm },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  stat: {
    flexGrow: 1,
    flexBasis: 100,
    gap: 2,
    padding: spacing.lg,
    borderRadius: radii.shell,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.cream,
  },
  tagText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 17,
    color: colors.forestDeep,
  },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.elevated,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  center: { textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1 },
});
