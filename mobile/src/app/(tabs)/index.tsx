import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AI_BUTTON_CLEARANCE, AiPropertyAssistant } from "@/home/components/ai-property-assistant";
import { CategoryChips } from "@/home/components/category-chips";
import { FeaturedAdsCarousel } from "@/home/components/featured-ads-carousel";
import { HeroSearch } from "@/home/components/hero-search";
import { HomePremiumBackground } from "@/home/components/home-premium-background";
import { HomeHeader } from "@/home/components/home-header";
import { TrustedCompanies } from "@/home/components/trusted-companies";
import { HOME_GUTTER, HOME_SECTION_GAP } from "@/home/components/layout";
import { DiscoveryFeed } from "@/home/discovery/feed";
import { MarketplaceModeSwitch } from "@/components/marketplace-mode-switch";
import { useMarketplaceMode } from "@/marketplace/mode";
import { ServicesHome } from "@/services/components/services-home";
import { colors, spacing } from "@/theme/tokens";

/**
 * Marketplace home. Under the header, the selector switches between the two NesAfric
 * marketplaces (Properties is the default on every launch):
 * - Properties: heading + search → category chips → advertising carousel → trusted companies,
 *   then the discovery feed (`DiscoveryFeed`): Top Ads, newly listed, cities, category and city
 *   collections, advanced search at the end.
 * - Service Providers: heading + service finder → services → providers on NesAfric.
 * Every section is backed by the real public API; nothing here is sample data. The floating
 * "Speak to AI" entry point (property search) sits above the tab bar in a touch-transparent layer.
 */
export default function HomeScreen() {
  const queryClient = useQueryClient();
  const { mode } = useMarketplaceMode();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await Promise.all(
      mode === "services"
        ? [queryClient.invalidateQueries({ queryKey: ["services"] })]
        : [queryClient.invalidateQueries({ queryKey: ["collection"] }), queryClient.invalidateQueries({ queryKey: ["home"] })],
    );
    setRefreshing(false);
  }

  const top = (
    <>
      <HomeHeader />
      <MarketplaceModeSwitch style={styles.modeSwitch} />
    </>
  );

  return (
    <View style={styles.root}>
      {/* Fixed, touch-transparent backdrop; everything below renders above it. */}
      <HomePremiumBackground />
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
        {mode === "services" ? (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
          >
            {top}
            <ServicesHome />
          </ScrollView>
        ) : (
          <DiscoveryFeed
            refreshing={refreshing}
            onRefresh={refresh}
            bottomInset={AI_BUTTON_CLEARANCE}
            header={
              <View style={styles.header}>
                {top}
                <HeroSearch />
                <CategoryChips />
                <FeaturedAdsCarousel />
                <TrustedCompanies />
              </View>
            }
          />
        )}
        {mode === "properties" ? <AiPropertyAssistant /> : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // The tab bar sits below; the extra bottom room keeps the last section clear of the floating
  // "Speak to AI" pill when scrolled to the end.
  content: { paddingTop: spacing.xs, paddingBottom: AI_BUTTON_CLEARANCE, gap: HOME_SECTION_GAP },
  header: { gap: HOME_SECTION_GAP },
  modeSwitch: { marginHorizontal: HOME_GUTTER },
});
