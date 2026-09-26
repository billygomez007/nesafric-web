import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdvancedSearchCTA } from "@/home/components/advanced-search-cta";
import { AI_BUTTON_CLEARANCE, AiPropertyAssistant } from "@/home/components/ai-property-assistant";
import { CategoryChips } from "@/home/components/category-chips";
import { FeaturedAdsCarousel } from "@/home/components/featured-ads-carousel";
import { HeroSearch } from "@/home/components/hero-search";
import { HomePremiumBackground } from "@/home/components/home-premium-background";
import { HomeHeader } from "@/home/components/home-header";
import { PropertiesOnNesAfric } from "@/home/components/properties-on-nesafric";
import { TrustedCompanies } from "@/home/components/trusted-companies";
import { HOME_SECTION_GAP } from "@/home/components/layout";
import { colors, spacing } from "@/theme/tokens";

/**
 * Marketplace home: header → heading + search → category chips → featured carousel → trusted
 * companies → properties on NesAfric → advanced search. Every section is backed by the real
 * public API; nothing here is sample data. The floating "Speak to AI" entry point sits above the
 * tab bar in a touch-transparent layer.
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
    <View style={styles.root}>
      {/* Fixed, touch-transparent backdrop; everything below renders above it. */}
      <HomePremiumBackground />
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
          <PropertiesOnNesAfric />
          <AdvancedSearchCTA />
        </ScrollView>
        <AiPropertyAssistant />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // The tab bar sits below this scroll view; the extra bottom room keeps the last section clear of
  // the floating "Speak to AI" pill when scrolled to the end.
  content: { paddingTop: spacing.xs, paddingBottom: AI_BUTTON_CLEARANCE, gap: HOME_SECTION_GAP },
});
