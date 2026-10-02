import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useApi } from "@/api/provider";
import type { PublicProvider } from "@/api/types";
import { AppText } from "@/components/ui";
import { resolveMediaUrl } from "@/marketplace/format";
import { availabilityLabel, formatCompletionRate, formatRating, initials, verificationBadges } from "@/services/format";
import { colors, fonts, radii } from "@/theme/tokens";

/**
 * The provider's logo when the server publishes one, over the initials avatar. The box is a fixed
 * size either way (no layout jump), and if the image fails to load the initials simply remain.
 */
export function ProviderAvatar({ name, logoUrl, size = 52 }: { name: string; logoUrl?: string | null; size?: number }) {
  const { apiUrl } = useApi();
  const [failed, setFailed] = useState(false);
  const uri = logoUrl && !failed ? resolveMediaUrl(logoUrl, apiUrl) : null;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} testID="provider-avatar">
      <AppText
        style={[styles.avatarText, { fontSize: size * 0.36, lineHeight: size * 0.46 }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {initials(name)}
      </AppText>
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, styles.logo, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
          accessibilityLabel={`${name} logo`}
          onError={() => setFailed(true)}
          testID="provider-logo"
        />
      ) : null}
    </View>
  );
}

/** "96% completion rate", only when the server computed one. */
export function CompletionRateLine({ provider }: { provider: Pick<PublicProvider, "completionRate"> }) {
  const label = formatCompletionRate(provider);
  return label ? <AppText style={styles.completion}>{label}</AppText> : null;
}

export function VerificationBadges({ provider }: { provider: Pick<PublicProvider, "verificationBadges"> }) {
  const badges = verificationBadges(provider);
  if (!badges.length) return null;
  return (
    <View style={styles.badges}>
      {badges.map((label) => (
        <View key={label} style={styles.badge} accessibilityLabel={label} testID="verification-badge">
          <Ionicons name="shield-checkmark" size={13} color={colors.brandStrong} />
          <AppText style={styles.badgeText}>{label}</AppText>
        </View>
      ))}
    </View>
  );
}

/** "★ 4.8 · 84 ratings", or "No ratings yet" — never an invented score. */
export function RatingLine({ provider }: { provider: Pick<PublicProvider, "aggregateRating" | "ratingCount"> }) {
  const rating = formatRating(provider);
  if (!rating) return <AppText style={styles.muted}>No ratings yet</AppText>;
  return (
    <View style={styles.inline} accessibilityLabel={`Rated ${rating.score} out of 5 from ${rating.count}`}>
      <Ionicons name="star" size={14} color={colors.gold} />
      <AppText style={styles.score}>{rating.score}</AppText>
      <AppText style={styles.muted}>({rating.count})</AppText>
    </View>
  );
}

export function AvailabilityPill({ provider }: { provider: Pick<PublicProvider, "availability" | "acceptingWork"> }) {
  const availability = availabilityLabel(provider);
  if (!availability) return null;
  const color = availability.tone === "success" ? colors.success : availability.tone === "warning" ? colors.warning : colors.muted;
  return (
    <View style={styles.inline}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText style={[styles.availability, { color: availability.tone === "muted" ? colors.muted : colors.ink }]}>{availability.label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.forest, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { fontFamily: fonts.bold, color: colors.goldLight },
  logo: { backgroundColor: colors.elevated },
  completion: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: "#e6f5f2",
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.brandStrong },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  score: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.ink },
  muted: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  availability: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
});
