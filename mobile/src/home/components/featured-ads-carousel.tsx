import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { recordCampaignClick, recordCampaignImpression } from "@/api/home";
import { useFeaturedCampaigns } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { AppText } from "@/components/ui";
import { buildFeaturedSlides, type FeaturedSlide, type SlideTarget } from "@/home/featured";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";

const CARD_GUTTER = 16;
const GAP = 16;
/** Impressions are reported once per campaign per app session, like the website carousel. */
const reportedImpressions = new Set<string>();

export function openSlideTarget(target: SlideTarget) {
  if (target.type === "listing") router.push({ pathname: "/listing/[id]", params: { id: target.id } });
  else if (target.type === "search") openSearch(target.filters);
  else void WebBrowser.openBrowserAsync(target.url);
}

/**
 * Homepage advertising carousel: eligible campaigns only (see `buildFeaturedSlides`). Hidden when
 * there are none or they can't be loaded — never filled with property listings.
 */
export function FeaturedAdsCarousel() {
  const { api, apiUrl } = useApi();
  const { width } = useWindowDimensions();
  const campaigns = useFeaturedCampaigns();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<FeaturedSlide>>(null);

  const cardWidth = Math.min(width - CARD_GUTTER * 2, 560);
  const cardHeight = Math.round(Math.min(Math.max(cardWidth * 0.55, 196), 300));
  const interval = cardWidth + GAP;
  const pending = campaigns.isPending;

  const slides = useMemo(() => buildFeaturedSlides(campaigns.data?.banners ?? [], apiUrl), [campaigns.data, apiUrl]);
  const current = Math.min(index, slides.length - 1);
  const visible = slides[current];

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

  function go(step: number) {
    const next = (current + step + slides.length) % slides.length;
    list.current?.scrollToOffset({ offset: next * interval, animated: true });
    setIndex(next);
  }

  const press = useCallback((slide: FeaturedSlide) => {
    recordCampaignClick(api, slide.campaignId).catch(() => undefined);
    openSlideTarget(slide.target);
  }, [api]);

  if (pending) {
    return <View accessibilityLabel="Loading sponsored campaigns" style={[styles.skeleton, { width: cardWidth, height: cardHeight }]} />;
  }
  if (slides.length === 0) return null;

  const multi = slides.length > 1;
  return (
    <View style={{ height: cardHeight }}>
      <FlatList
        ref={list}
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
        getItemLayout={(_, i) => ({ length: interval, offset: interval * i, index: i })}
        accessibilityLabel="Sponsored campaigns"
      />
      {multi ? (
        <>
          <View pointerEvents="none" style={[styles.dots, { left: CARD_GUTTER, width: cardWidth }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {slides.map((slide, i) => <View key={slide.key} style={[styles.dot, i === current && styles.dotActive]} />)}
          </View>
          <View style={[styles.arrows, { right: CARD_GUTTER + 14 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous campaign" hitSlop={6} onPress={() => go(-1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.white} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next campaign" hitSlop={6} onPress={() => go(1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.white} />
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function Slide({ slide, width, height, onPress }: { slide: FeaturedSlide; width: number; height: number; onPress: (slide: FeaturedSlide) => void }) {
  return (
    <View style={[styles.slide, { width, height }]}>
      {slide.imageUrl ? (
        <Image source={{ uri: slide.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.brandFill]} />
      )}
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.copy}>
        <View style={styles.eyebrow}>
          <AppText style={styles.eyebrowText} numberOfLines={1}>{slide.eyebrow}</AppText>
        </View>
        <AppText style={styles.title} numberOfLines={3}>{slide.title}</AppText>
        {slide.subtitle ? <AppText style={styles.subtitle} numberOfLines={2}>{slide.subtitle}</AppText> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${slide.ctaLabel}: ${slide.title}`}
          onPress={() => onPress(slide)}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <AppText style={styles.ctaText}>{slide.ctaLabel}</AppText>
          <MaterialCommunityIcons name="arrow-right" size={16} color={colors.white} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { paddingHorizontal: CARD_GUTTER },
  skeleton: { marginHorizontal: CARD_GUTTER, borderRadius: radii.shell, backgroundColor: colors.cream },
  slide: { borderRadius: radii.shell, overflow: "hidden", backgroundColor: colors.forestDeep, justifyContent: "center" },
  brandFill: { backgroundColor: colors.forest },
  // Dark from the left so the copy column reads on any photograph; the right side stays photographic.
  shade: { experimental_backgroundImage: "linear-gradient(90deg, rgba(0,22,20,0.9) 0%, rgba(0,22,20,0.72) 42%, rgba(0,22,20,0.15) 72%, rgba(0,22,20,0) 100%)" },
  copy: { width: "62%", paddingLeft: 18, paddingRight: 8, paddingBottom: 18, gap: 6 },
  eyebrow: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.control, backgroundColor: "rgba(0,63,58,0.92)" },
  eyebrowText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, color: colors.white, letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 25, color: colors.white },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, color: "rgba(255,255,255,0.9)" },
  cta: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: colors.forest,
  },
  ctaPressed: { backgroundColor: colors.forestDeep },
  ctaText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.white },
  dots: { position: "absolute", bottom: 12, flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.45)" },
  dotActive: { backgroundColor: colors.white },
  arrows: { position: "absolute", bottom: 10, flexDirection: "row", gap: 8 },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,22,20,0.7)" },
  arrowPressed: { backgroundColor: "rgba(0,22,20,0.9)" },
});
