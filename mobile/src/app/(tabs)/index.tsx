import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdvancedSearchCTA } from "@/home/components/advanced-search-cta";
import { CategoryChips } from "@/home/components/category-chips";
import { FeaturedAdsCarousel } from "@/home/components/featured-ads-carousel";
import { HeroSearch } from "@/home/components/hero-search";
import { HomeHeader } from "@/home/components/home-header";
import { PropertySearchSection } from "@/home/components/property-search-section";
import { TrustedCompanies } from "@/home/components/trusted-companies";
import { HOME_SECTION_GAP } from "@/home/components/layout";
import { colors, spacing } from "@/theme/tokens";

/**
 * Marketplace home, in the order of the homepage brief: header → heading + search → category
 * chips → featured carousel → trusted companies → property search cards → advanced search. Every
 * section is backed by the real public API; nothing here is sample data.
 */
export default function HomeScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["collection"] }),
      queryClient.invalidateQueries({ queryKey: ["home"] }),
    ]);
    setRefreshing(false);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
      >
        <HomeHeader />
        <HeroSearch />
        <CategoryChips />
        <FeaturedAdsCarousel />
        <TrustedCompanies />
        <PropertySearchSection />
        <AdvancedSearchCTA />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  // The tab bar sits below this scroll view, so the last card only needs breathing room.
  content: { paddingTop: spacing.xs, paddingBottom: spacing.xl, gap: HOME_SECTION_GAP },
});
