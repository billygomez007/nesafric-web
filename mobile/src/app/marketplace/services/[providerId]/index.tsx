import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { useMarketplaceProvider } from "@/api/service-queries";
import type { PublicProvider } from "@/api/types";
import { QueryState } from "@/components/query-state";
import { AppText, Button, StateMessage } from "@/components/ui";
import { SaveProviderButton } from "@/services/components/save-provider-button";
import { AvailabilityPill, ProviderAvatar, VerificationBadges } from "@/services/components/trust";
import { formatArea, formatCompletionRate, formatRating, formatResponseTime, formatStartingRate, providerTypeLabel } from "@/services/format";
import { openProviderSearch, openRequestService } from "@/services/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

/**
 * Public service provider profile. Accepts the provider id, or the website's profile slug so a
 * shared `/marketplace/services/<slug>` link opens the same profile.
 */
export default function ProviderProfileScreen() {
  const { providerId } = useLocalSearchParams<{ providerId: string }>();
  const query = useMarketplaceProvider(providerId);
  const provider = query.data?.provider;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: provider?.displayName ?? "", headerRight: provider ? () => <SaveProviderButton provider={provider} /> : undefined }} />
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
        <QueryState isPending={query.isPending} error={query.error} onRetry={() => query.refetch()} />
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
  const completion = formatCompletionRate(provider) ? Math.round((provider.completionRate as number) * 100) : null;
  const notTakingWork =
    provider.verification !== "VERIFIED"
    || !provider.acceptingWork
    || provider.availability === "UNAVAILABLE";

  return (
    <>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 140 + insets.bottom }]}>
        <View style={styles.identity}>
          <ProviderAvatar name={provider.displayName} logoUrl={provider.logo?.url} size={68} />
          <View style={styles.identityText}>
            <AppText accessibilityRole="header" style={styles.name}>{provider.displayName}</AppText>
            <AppText style={styles.meta}>{[type, provider.categories[0]?.name].filter(Boolean).join(" · ")}</AppText>
            <AvailabilityPill provider={provider} />
          </View>
        </View>
        <VerificationBadges provider={provider} />

        <Section title="NesAfric record">
          <View style={styles.stats}>
            <Stat testID="stat-rating" value={rating ? rating.score : "—"} label={rating ? rating.count : "No ratings yet"} icon="star" />
            <Stat testID="stat-jobs" value={provider.completedJobs.toLocaleString()} label={provider.completedJobs === 1 ? "job completed" : "jobs completed"} icon="checkmark-done" />
            {completion !== null ? <Stat testID="stat-completion" value={`${completion}%`} label="completion rate" icon="checkmark-circle" /> : null}
          </View>
          <AppText variant="caption">
            Counted by NesAfric. Ratings come only from property managers after a completed NesAfric work order.
            {completion !== null && provider.completionRateBasis
              ? ` Completion rate covers the ${provider.completionRateBasis.toLocaleString()} jobs this provider accepted that have since finished.`
              : ""}
          </AppText>
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
                <Ionicons name="location-outline" size={16} color={colors.muted} />
                <AppText>{formatArea(area)}</AppText>
              </View>
            ))}
          </Section>
        ) : null}

        {rate || response ? (
          <Section title="From the provider">
            {rate ? <Fact label="Starting rate" value={rate} /> : null}
            {response ? <Fact label="Stated response time" value={response} /> : null}
            <AppText variant="caption">Set by the provider. Ask for a quote for your exact job.</AppText>
          </Section>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: spacing.md + insets.bottom }]}>
        {notTakingWork ? <AppText variant="caption" style={styles.center}>This provider isn’t taking new work right now and may not respond.</AppText> : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button label="Get quote" variant="secondary" onPress={() => openRequestService(provider.id, firstCategory, true)} />
          </View>
          <View style={styles.action}>
            <Button label="Request service" onPress={() => openRequestService(provider.id, firstCategory)} testID="profile-request-service" />
          </View>
        </View>
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

function Stat({ value, label, icon, testID }: { value: string; label: string; icon: "star" | "checkmark-done" | "checkmark-circle"; testID: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <View style={styles.inline}>
        <Ionicons name={icon} size={16} color={icon === "star" ? colors.gold : colors.brandStrong} />
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
  screen: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, gap: spacing.xl },
  identity: { flexDirection: "row", gap: spacing.lg, alignItems: "center" },
  identityText: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: colors.forestDeep },
  meta: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted },
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
  statValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  inline: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.cream },
  tagText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17, color: colors.forestDeep },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.hairline },
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
