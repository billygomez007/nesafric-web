import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { PublicProvider } from "@/api/types";
import { AppText } from "@/components/ui";
import { formatPrimaryArea, formatStartingRate } from "@/services/format";
import { openProvider } from "@/services/navigation";
import { AvailabilityPill, ProviderAvatar, RatingLine } from "@/services/components/trust";
import { colors, fonts, radii } from "@/theme/tokens";

function describe(provider: PublicProvider, focusKey?: string) {
  const category = provider.categories.find((item) => item.key === focusKey) ?? provider.categories[0];
  const area = formatPrimaryArea(provider);
  return { category: category?.name ?? null, area, label: [provider.displayName, category?.name, area].filter(Boolean).join(", ") };
}

function Area({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.inline}>
      <MaterialCommunityIcons name="map-marker-outline" size={13} color={colors.muted} />
      <AppText style={styles.meta} numberOfLines={1}>{text}</AppText>
    </View>
  );
}

/**
 * Discovery cards are profile links only, like the Properties Home cards: saving and requesting
 * a service live on the profile, Search and Saved. Every figure is the server's own.
 */
export const ProviderRailCard = memo(function ProviderRailCard({ provider, width, focusKey, testID }: { provider: PublicProvider; width: number; focusKey?: string; testID?: string }) {
  const { category, area, label } = describe(provider, focusKey);
  const rate = formatStartingRate(provider);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
      onPress={() => openProvider(provider.id)}
      style={({ pressed }) => [styles.rail, { width }, pressed && styles.pressed]}
    >
      <View style={styles.railTop}>
        <ProviderAvatar name={provider.displayName} logoUrl={provider.logo?.url} size={56} />
        <View style={styles.grow}>
          <AppText style={styles.name} numberOfLines={2}>{provider.displayName}</AppText>
          {category ? <AppText style={styles.category} numberOfLines={1}>{category}</AppText> : null}
        </View>
      </View>
      <Area text={area} />
      <RatingLine provider={provider} />
      <View style={styles.railFooter}>
        <AvailabilityPill provider={provider} />
        <AppText style={styles.rate} numberOfLines={1}>{rate ?? "Request a quote"}</AppText>
      </View>
    </Pressable>
  );
});

export const ProviderGridCard = memo(function ProviderGridCard({ provider, width, focusKey, testID }: { provider: PublicProvider; width: number; focusKey?: string; testID?: string }) {
  const { category, area, label } = describe(provider, focusKey);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
      onPress={() => openProvider(provider.id)}
      style={({ pressed }) => [styles.grid, { width }, pressed && styles.pressed]}
    >
      <ProviderAvatar name={provider.displayName} logoUrl={provider.logo?.url} />
      <View style={styles.body}>
        <AppText style={styles.name} numberOfLines={2}>{provider.displayName}</AppText>
        {category ? <AppText style={styles.category} numberOfLines={1}>{category}</AppText> : null}
        <Area text={area} />
        <RatingLine provider={provider} />
      </View>
    </Pressable>
  );
});

export const ProviderCompactRow = memo(function ProviderCompactRow({ provider, last, focusKey, testID }: { provider: PublicProvider; last: boolean; focusKey?: string; testID?: string }) {
  const { category, area, label } = describe(provider, focusKey);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
      onPress={() => openProvider(provider.id)}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.rowPressed]}
    >
      <ProviderAvatar name={provider.displayName} logoUrl={provider.logo?.url} size={44} />
      <View style={[styles.grow, styles.body]}>
        <AppText style={styles.name} numberOfLines={1}>{provider.displayName}</AppText>
        <AppText style={styles.meta} numberOfLines={1}>{[category, area].filter(Boolean).join(" · ")}</AppText>
        <RatingLine provider={provider} />
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
});

/** A city providers serve; opens Search for providers in that city. */
export function ProviderCityTile({ city, onPress }: { city: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Service providers in ${city}`}
      testID={`services-city-${city}`}
      onPress={onPress}
      style={({ pressed }) => [styles.city, pressed && styles.rowPressed]}
    >
      <View style={styles.cityIcon}>
        <MaterialCommunityIcons name="city-variant-outline" size={20} color={colors.forestDeep} />
      </View>
      <AppText style={styles.cityName} numberOfLines={1}>{city}</AppText>
    </Pressable>
  );
}

const card = { borderRadius: radii.shell, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated } as const;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.9 },
  inline: { flexDirection: "row", alignItems: "center", gap: 3 },
  body: { gap: 3 },
  name: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.forestDeep },
  category: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink },
  meta: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  rate: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17, color: colors.forestDeep },
  rail: { ...card, padding: 14, gap: 10, minHeight: 196 },
  railTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  railFooter: { marginTop: "auto", paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.hairline, gap: 4 },
  grid: { ...card, padding: 12, gap: 10, minHeight: 174 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 72 },
  rowPressed: { backgroundColor: colors.surface },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  city: { ...card, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 56, minWidth: 140 },
  cityIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  cityName: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.forestDeep },
});
