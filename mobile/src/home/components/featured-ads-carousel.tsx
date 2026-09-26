import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { recordCampaignClick, recordCampaignImpression } from "@/api/home";
import { useFeaturedCampaigns } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { useListingCollection } from "@/api/queries";
import { AppText } from "@/components/ui";
import { buildFeaturedSlides, type FeaturedSlide, type SlideTarget } from "@/home/featured";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

const GUTTER = spacing.xl;
const GAP = spacing.md;
/** Impressions are reported once per campaign per app session, like the website carousel. */
const reportedImpressions = new Set<string>();

export function openSlideTarget(target: SlideTarget) {
  if (target.type === "listing") router.push({ pathname: "/listing/[id]", params: { id: target.id } });
  else if (target.type === "search") openSearch(target.filters);
  else void WebBrowser.openBrowserAsync(target.url);
}

/** Large featured carousel: sponsored campaigns, else the newest real listings (see `buildFeaturedSlides`). */
export function FeaturedAdsCarousel() {
  const { api, apiUrl } = useApi();
  const { width } = useWindowDimensions();
  const campaigns = useFeaturedCampaigns();
  const newest = useListingCollection("newest", {});
  const [index, setIndex] = useState(0);

  const cardWidth = Math.min(width - GUTTER * 2, 520);
  const cardHeight = Math.round(Math.min(cardWidth * 0.9, 380));
  const pending = campaigns.isPending || (newest.isPending && !campaigns.data?.banners.length);

  const slides = useMemo(
    () => buildFeaturedSlides(campaigns.data?.banners ?? [], newest.data?.items ?? [], apiUrl),
    [campaigns.data, newest.data, apiUrl],
  );

  const interval = cardWidth + GAP;
  const visible = slides[Math.min(index, slides.length - 1)];

  // Report a sponsored slide's impression once it is actually on screen (once per session).
  useEffect(() => {
    const campaignId = pending ? undefined : visible?.campaignId;
    if (!campaignId || reportedImpressions.has(campaignId)) return;
    reportedImpressions.add(campaignId);
    recordCampaignImpression(api, campaignId).catch(() => reportedImpressions.delete(campaignId));
  }, [api, pending, visible]);

  function settle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.max(0, Math.round(event.nativeEvent.contentOffset.x / interval)));
  }

  const press = useCallback((slide: FeaturedSlide) => {
    if (slide.campaignId) recordCampaignClick(api, slide.campaignId).catch(() => undefined);
    openSlideTarget(slide.target);
  }, [api]);

  if (pending) {
    return <View accessibilityLabel="Loading featured properties" style={[styles.skeleton, { width: cardWidth, height: cardHeight }]} />;
  }

  return (
    <View style={styles.wrap}>
      <FlatList
        horizontal
        data={slides}
        keyExtractor={(slide) => slide.key}
        renderItem={({ item }) => <Slide slide={item} width={cardWidth} height={cardHeight} onPress={press} />}
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={styles.track}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        onMomentumScrollEnd={settle}
        accessibilityLabel="Featured properties"
      />
      {slides.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {slides.map((slide, i) => <View key={slide.key} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
      ) : null}
    </View>
  );
}

function Slide({ slide, width, height, onPress }: { slide: FeaturedSlide; width: number; height: number; onPress: (slide: FeaturedSlide) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[slide.eyebrow, slide.title, slide.subtitle, slide.ctaLabel].filter(Boolean).join(". ")}
      onPress={() => onPress(slide)}
      style={({ pressed }) => [styles.slide, { width, height }, pressed && styles.pressed]}
    >
      {slide.imageUrl ? (
        <Image source={{ uri: slide.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.brandFill]} />
      )}
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.copy}>
        <View style={styles.eyebrow}>
          <AppText style={styles.eyebrowText}>{slide.eyebrow}</AppText>
        </View>
        <AppText style={styles.title} numberOfLines={2}>{slide.title}</AppText>
        {slide.subtitle ? <AppText style={styles.subtitle} numberOfLines={2}>{slide.subtitle}</AppText> : null}
        <View style={styles.cta}>
          <AppText style={styles.ctaText}>{slide.ctaLabel}</AppText>
          <Ionicons name="arrow-forward" size={16} color={colors.forest} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  track: { paddingHorizontal: GUTTER },
  skeleton: { marginHorizontal: GUTTER, borderRadius: radii.shell, backgroundColor: colors.cream },
  slide: { borderRadius: radii.shell, overflow: "hidden", backgroundColor: colors.forestDeep, justifyContent: "flex-end" },
  pressed: { opacity: 0.94 },
  brandFill: { backgroundColor: colors.forest },
  // Dark gradient from the lower half so white copy reads on any photograph.
  shade: { experimental_backgroundImage: "linear-gradient(180deg, rgba(0,20,18,0.05) 20%, rgba(0,20,18,0.55) 52%, rgba(0,20,18,0.9) 100%)" },
  copy: { padding: spacing.xl, gap: spacing.sm },
  eyebrow: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.control, backgroundColor: "rgba(0,31,28,0.72)" },
  eyebrowText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.goldLight, letterSpacing: 0.4, textTransform: "uppercase" },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.white },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: "rgba(255,255,255,0.86)" },
  cta: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
  },
  ctaText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: colors.forest },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hairline },
  dotActive: { width: 18, backgroundColor: colors.forest },
});
