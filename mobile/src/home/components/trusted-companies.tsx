import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { DirectoryCompany } from "@/api/home";
import { useVerifiedCompanies } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { AppText } from "@/components/ui";
import { resolveMediaUrl } from "@/marketplace/format";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { SectionHeading } from "./section-heading";

/** Initials for companies without an uploaded logo — a neutral mark, never an invented logo. */
export function monogram(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

/**
 * Verified companies from the public directory. Only logos the company uploaded are shown; the
 * section says so honestly when nobody is verified yet instead of showing sample brands.
 */
export function TrustedCompanies() {
  const { apiUrl } = useApi();
  const companies = useVerifiedCompanies();
  const items = companies.data?.items ?? [];
  const openProfile = (company: DirectoryCompany) => WebBrowser.openBrowserAsync(`${apiUrl}/marketplace/professionals/${encodeURIComponent(company.slug)}`);

  return (
    <View style={styles.section}>
      <SectionHeading title="Trusted companies on NesAfric" subtitle="Agencies and developers verified by NesAfric" />
      {companies.isPending ? (
        <View style={styles.rowPlaceholder} accessibilityLabel="Loading companies" />
      ) : items.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/for-professionals`)}
          style={({ pressed }) => [styles.empty, pressed && styles.pressed]}
        >
          <View style={styles.emptyIcon}><Ionicons name="shield-checkmark-outline" size={20} color={colors.gold} /></View>
          <View style={styles.emptyCopy}>
            <AppText style={styles.emptyTitle}>Verified companies will appear here</AppText>
            <AppText variant="caption">Are you an agency or developer? Get verified</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityLabel="Verified companies">
          {items.map((company) => (
            <Pressable
              key={company.slug}
              accessibilityRole="link"
              accessibilityLabel={`${company.displayName}, verified company`}
              onPress={() => openProfile(company)}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              <View style={styles.logoBox}>
                {company.logoUrl ? (
                  <Image source={{ uri: resolveMediaUrl(company.logoUrl, apiUrl) }} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors />
                ) : (
                  <AppText style={styles.monogram}>{monogram(company.displayName)}</AppText>
                )}
              </View>
              <AppText numberOfLines={1} style={styles.name}>{company.displayName}</AppText>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  row: { paddingHorizontal: spacing.xl, gap: spacing.md },
  rowPlaceholder: { height: 96, marginHorizontal: spacing.xl, borderRadius: radii.panel, backgroundColor: colors.cream },
  tile: { width: 96, alignItems: "center", gap: spacing.xs },
  pressed: { opacity: 0.85 },
  logoBox: {
    width: 96,
    height: 64,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  logo: { width: "100%", height: "100%" },
  monogram: { fontFamily: fonts.bold, fontSize: 18, color: colors.forest },
  name: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.ink, textAlign: "center", maxWidth: 96 },
  empty: {
    marginHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream },
  emptyCopy: { flex: 1, gap: 2 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
});
