import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useState } from "react";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { DirectoryCompany } from "@/api/home";
import { useVerifiedCompanies } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { AppText } from "@/components/ui";
import { resolveMediaUrl } from "@/marketplace/format";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";
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
  const [page, setPage] = useState(0);
  const openProfile = (company: DirectoryCompany) => WebBrowser.openBrowserAsync(`${apiUrl}/marketplace/professionals/${encodeURIComponent(company.slug)}`);
  const pages = Math.max(1, Math.ceil(items.length / 5));

  return (
    <View style={styles.section}>
      <SectionHeading
        size="small"
        title="Trusted by leading companies"
        action={items.length ? { label: "See all", onPress: () => void WebBrowser.openBrowserAsync(`${apiUrl}/marketplace/professionals`) } : undefined}
      />
      {companies.isPending ? (
        <View style={styles.rowPlaceholder} accessibilityLabel="Loading companies" />
      ) : items.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/for-professionals`)}
          style={({ pressed }) => [styles.empty, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="shield-check-outline" size={22} color={colors.gold} />
          <View style={styles.emptyCopy}>
            <AppText style={styles.emptyTitle}>Verified companies appear here</AppText>
            <AppText style={styles.emptyBody}>Agency or developer? Get verified</AppText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
      ) : (
        <View style={styles.carousel}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            accessibilityLabel="Verified companies"
            scrollEventThrottle={32}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const max = Math.max(1, contentSize.width - layoutMeasurement.width);
              setPage(Math.min(pages - 1, Math.round((contentOffset.x / max) * (pages - 1))));
            }}
          >
            {items.map((company) => (
              <Pressable
                key={company.slug}
                accessibilityRole="link"
                accessibilityLabel={`${company.displayName}, verified company`}
                onPress={() => openProfile(company)}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              >
                {company.logoUrl ? (
                  <Image source={{ uri: resolveMediaUrl(company.logoUrl, apiUrl) }} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors />
                ) : (
                  <View style={styles.monogramWrap}>
                    <AppText style={styles.monogram}>{monogram(company.displayName)}</AppText>
                    <AppText numberOfLines={1} style={styles.name}>{company.displayName}</AppText>
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
          {pages > 1 ? (
            <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {Array.from({ length: pages }, (_, i) => <View key={i} style={[styles.dot, i === page && styles.dotActive]} />)}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  carousel: { gap: 12 },
  row: { paddingHorizontal: HOME_GUTTER, paddingVertical: 4, gap: 10 },
  rowPlaceholder: { height: 56, marginHorizontal: HOME_GUTTER, borderRadius: radii.panel, backgroundColor: colors.cream },
  pressed: { opacity: 0.85 },
  // Logo tiles: white, softly raised, logos contained with padding — never stretched.
  tile: {
    width: 64,
    height: 56,
    borderRadius: radii.panel,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    shadowColor: "#102d2a",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  logo: { width: "100%", height: "100%" },
  monogramWrap: { alignItems: "center", gap: 1, maxWidth: 56 },
  monogram: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: colors.forestDeep },
  name: { fontFamily: fonts.regular, fontSize: 8, lineHeight: 10, color: colors.muted },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.forestDeep },
  empty: {
    marginHorizontal: HOME_GUTTER,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.panel,
    backgroundColor: colors.elevated,
    shadowColor: "#102d2a",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  emptyCopy: { flex: 1 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.ink },
  emptyBody: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
});
