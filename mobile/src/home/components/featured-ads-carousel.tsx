import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { recordCampaignClick, recordCampaignImpression } from "@/api/home";
import { useFeaturedCampaigns } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { buildFeaturedSlides, NATIVE_CREATIVE_RATIO, type FeaturedSlide, type SlideTarget } from "@/home/featured";
import { openSearch } from "@/marketplace/navigation";
import { colors, radii } from "@/theme/tokens";

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
 *
 * A campaign's uploaded artwork is the finished creative. Nothing is painted over it or added
 * around it as campaign copy. Navigation controls remain platform UI; the headline is accessibility-only.
 */
export function FeaturedAdsCarousel() {
  const { api, apiUrl } = useApi();
  const { width } = useWindowDimensions();
  const campaigns = useFeaturedCampaigns();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<FeaturedSlide>>(null);

  const cardWidth = Math.min(width - CARD_GUTTER * 2, 560);
  // The native creative canvas ratio, so the uploaded art is neither cropped nor letterboxed.
  const cardHeight = Math.round(cardWidth * NATIVE_CREATIVE_RATIO);
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
    <View>
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
          accessibilityLabel="Advertising campaigns"
        />
      </View>

      {multi ? (
        <View style={[styles.footer, { marginHorizontal: CARD_GUTTER, width: cardWidth }]}>
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {slides.map((slide, i) => <View key={slide.key} style={[styles.dot, i === current && styles.dotActive]} />)}
          </View>
          <View style={styles.arrows}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous campaign" hitSlop={8} onPress={() => go(-1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}>
              <MaterialCommunityIcons name="chevron-left" size={22} color={colors.ink} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next campaign" hitSlop={8} onPress={() => go(1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Slide({ slide, width, height, onPress }: { slide: FeaturedSlide; width: number; height: number; onPress: (slide: FeaturedSlide) => void }) {
  return (
    <Pressable
      testID={`campaign-slide-${slide.campaignId}`}
      accessibilityRole="button"
      // Advertising disclosure for screen readers only; nothing is drawn over the artwork.
      accessibilityLabel={`Sponsored: ${slide.title}`}
      accessibilityHint={slide.target.type === "web" ? "Opens advertiser page" : "Opens on NesAfric"}
      onPress={() => onPress(slide)}
      style={({ pressed }) => [styles.slide, { width, height }, pressed && styles.slidePressed]}
    >
      <Image
        testID="campaign-art"
        source={{ uri: slide.imageUrl }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        transition={150}
        accessibilityIgnoresInvertColors
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { paddingHorizontal: CARD_GUTTER },
  skeleton: { marginHorizontal: CARD_GUTTER, borderRadius: radii.shell, backgroundColor: colors.cream },
  slide: { borderRadius: radii.shell, overflow: "hidden", backgroundColor: colors.cream, justifyContent: "center" },
  slidePressed: { opacity: 0.96 },
  footer: { marginTop: 8, minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.forest },
  arrows: { flexDirection: "row", gap: 8 },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated },
  arrowPressed: { backgroundColor: colors.surface },
});
