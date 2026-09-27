import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, View } from "react-native";
import { websiteUrl } from "@/config";

import type { DirectoryCompany } from "@/api/home";
import { useVerifiedCompanies } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { resolveMediaUrl } from "@/marketplace/format";
import { colors, radii } from "@/theme/tokens";
import { LogoRail, RAIL_TILE } from "./logo-rail";
import { SectionHeading } from "./section-heading";

const PLACEHOLDER_TILES = 6;

/**
 * Companies the rail may show: verified by NesAfric, with a logo they uploaded, once each.
 * Anything else (unverified, test or logo-less profiles) is left out rather than approximated.
 */
export function railCompanies(items: DirectoryCompany[]) {
  const seen = new Set<string>();
  return items.filter((company) => {
    if (company.verificationStatus !== "VERIFIED" || !company.logoUrl?.trim() || seen.has(company.slug)) return false;
    seen.add(company.slug);
    return true;
  });
}

/**
 * "Trusted by leading companies": a slowly moving, swipeable rail of verified companies' logos.
 * Until real logos exist it shows neutral, non-interactive tiles — never invented brands, and no
 * repo-provided partner logos exist to stand in for them.
 */
export function TrustedCompanies() {
  const { apiUrl } = useApi();
  const companies = useVerifiedCompanies();
  const items = railCompanies(companies.data?.items ?? []);
  const openProfile = (company: DirectoryCompany) =>
    void WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `/marketplace/professionals/${encodeURIComponent(company.slug)}`));

  return (
    <View style={styles.section}>
      <SectionHeading
        size="small"
        title="Trusted by leading companies"
        action={items.length ? { label: "See all", onPress: () => void WebBrowser.openBrowserAsync(websiteUrl(apiUrl, `/marketplace/professionals`)) } : undefined}
      />
      {items.length ? (
        <LogoRail
          label="Verified companies"
          count={items.length}
          renderTile={(index, key, hidden) => {
            const company = items[index]!;
            return (
              <Pressable
                key={key}
                accessibilityRole="link"
                accessibilityLabel={`${company.displayName}, verified company`}
                accessibilityElementsHidden={hidden}
                importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
                onPress={() => openProfile(company)}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              >
                <Image
                  source={{ uri: resolveMediaUrl(company.logoUrl!, apiUrl) }}
                  style={styles.logo}
                  contentFit="contain"
                  accessibilityIgnoresInvertColors
                />
              </Pressable>
            );
          }}
        />
      ) : (
        // Loading, empty and failed directory all look the same: a quiet rail, no call to action.
        <LogoRail
          label={companies.isPending ? "Loading companies" : "Verified company logos will appear here"}
          testID="company-rail-placeholder"
          count={PLACEHOLDER_TILES}
          renderTile={(_, key) => (
            // A neutral mark + wordmark silhouette: reads as "a logo goes here", names no one.
            <View key={key} style={[styles.tile, styles.placeholderTile]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.placeholderMark} />
              <View style={styles.placeholderWord} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  pressed: { opacity: 0.8 },
  // Equal-size light tiles; logos are contained with padding, never stretched or cropped.
  tile: {
    width: RAIL_TILE.width,
    height: RAIL_TILE.height,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    gap: 5,
  },
  logo: { width: "100%", height: "100%" },
  placeholderTile: { flexDirection: "row", gap: 6 },
  placeholderMark: { width: 16, height: 16, borderRadius: 4, backgroundColor: colors.cream },
  placeholderWord: { width: 38, height: 8, borderRadius: 4, backgroundColor: colors.cream },
});
