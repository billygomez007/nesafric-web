import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import type { PublicProvider } from "@/api/types";
import { AppText, Button } from "@/components/ui";
import { formatCompletedJobs, formatPrimaryArea, formatStartingRate, providerTypeLabel } from "@/services/format";
import { openProvider, openRequestService } from "@/services/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { SaveProviderButton } from "./save-provider-button";
import { AvailabilityPill, CompletionRateLine, ProviderAvatar, RatingLine, VerificationBadges } from "./trust";

/**
 * Service provider card: who they are, what NesAfric has verified, and their record on the
 * platform (ratings, completed jobs and completion rate, all computed by the server). Shared by
 * Home, Search and Saved. `focusCategoryId` is the
 * service the person is browsing, carried into Request Service.
 */
export function ProviderCard({ provider, focusCategoryId }: { provider: PublicProvider; focusCategoryId?: string }) {
  const type = providerTypeLabel(provider.type);
  const mainCategory = provider.categories.find((category) => category.id === focusCategoryId) ?? provider.categories[0];
  const otherCategories = provider.categories.filter((category) => category.id !== mainCategory?.id);
  const area = formatPrimaryArea(provider);
  const rate = formatStartingRate(provider);

  return (
    <View style={styles.card} testID={`provider-card-${provider.id}`}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[provider.displayName, mainCategory?.name, area].filter(Boolean).join(", ")}
        onPress={() => openProvider(provider.id)}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <View style={styles.top}>
          <ProviderAvatar name={provider.displayName} logoUrl={provider.logo?.url} />
          <View style={styles.identity}>
            <AppText style={styles.name} numberOfLines={2}>{provider.displayName}</AppText>
            <AppText style={styles.meta} numberOfLines={1}>
              {[mainCategory?.name, type].filter(Boolean).join(" · ")}
            </AppText>
            {area ? (
              <View style={styles.inline}>
                <Ionicons name="location-outline" size={13} color={colors.muted} />
                <AppText style={styles.meta} numberOfLines={1}>{area}</AppText>
              </View>
            ) : null}
          </View>
          <SaveProviderButton provider={provider} />
        </View>

        <VerificationBadges provider={provider} />

        <View style={styles.record}>
          <RatingLine provider={provider} />
          <AppText style={styles.recordItem}>
            {provider.completedJobs > 0 ? formatCompletedJobs(provider.completedJobs) : "New on NesAfric"}
          </AppText>
          <CompletionRateLine provider={provider} />
        </View>

        {otherCategories.length ? (
          <AppText style={styles.also} numberOfLines={1}>Also: {otherCategories.map((category) => category.name).join(", ")}</AppText>
        ) : null}

        <View style={styles.footer}>
          <AvailabilityPill provider={provider} />
          <AppText style={styles.rate}>{rate ?? "Request a quote"}</AppText>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="View profile" variant="secondary" onPress={() => openProvider(provider.id)} />
        </View>
        <View style={styles.action}>
          <Button label="Request service" onPress={() => openRequestService(provider.id, mainCategory?.id)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.elevated,
    borderRadius: radii.shell,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
  },
  main: { gap: spacing.md },
  pressed: { opacity: 0.9 },
  top: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  identity: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.forestDeep },
  meta: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  inline: { flexDirection: "row", alignItems: "center", gap: 3 },
  record: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.lg, rowGap: 4 },
  recordItem: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink },
  also: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  rate: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.forestDeep },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1 },
});
