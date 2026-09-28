import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { recordCampaignClick, recordCampaignImpression } from "@/api/home";
import { useFeaturedCampaigns } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { buildFeaturedSlides, type FeaturedSlide, type SlideTarget } from "@/home/featured";
import { openSearch } from "@/marketplace/navigation";
import { colors, radii } from "@/theme/tokens";

const CARD_GUTTER = 16;
const GAP = 16;
/** Native campaign upload canvas, 1200 × 792 (see `modules/campaigns/creative-spec.ts`). */
const CAMPAIGN_ASPECT = 792 / 1200;
const CAMPAIGN_MAX_HEIGHT = 320;
/** Impressions are reported once per campaign per app session, like the website carousel. */
const reportedImpressions = new Set<string>();

export function openSlideTarget(target: SlideTarget) {
  if (target.type === "listing") router.push({ pathname: "/listing/[id]", params: { id: target.id } });
  else if (target.type === "search") openSearch(target.filters);
  else void WebBrowser.openBrowserAsync(target.url);
}

/**
 * The homepage advertising carousel: live campaigns only (see `buildFeaturedSlides`). With no
 * campaign that has artwork, nothing renders, not even a placeholder. Each campaign's artwork is
 * shown exactly as uploaded, uncropped, in a card of the native upload's proportions; the carousel
 * controls sit below the card, never over the artwork.
 */
export function FeaturedAdsCarousel() {
  const { api, apiUrl } = useApi();
  const { width } = useWindowDimensions();
  const campaigns = useFeaturedCampaigns();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<FeaturedSlide>>(null);

  const cardWidth = Math.min(width - CARD_GUTTER * 2, 560);
  const cardHeight = Math.round(Math.min(cardWidth * CAMPAIGN_ASPECT, CAMPAIGN_MAX_HEIGHT));
  const interval = cardWidth + GAP;

  const slides = useMemo(() => buildFeaturedSlides(campaigns.data?.banners ?? [], apiUrl), [campaigns.data, apiUrl]);
  const current = Math.min(index, slides.length - 1);
  const visible = slides[current];

  // Report a campaign's impression once it is actually on screen (once per session).
  useEffect(() => {
    const campaignId = visible?.campaignId;
    if (!campaignId || reportedImpressions.has(campaignId)) return;
    reportedImpressions.add(campaignId);
    recordCampaignImpression(api, campaignId).catch(() => reportedImpressions.delete(campaignId));
  }, [api, visible]);

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

  // Loading, failed, or no campaign with artwork: the advertising slot is simply absent.
  if (slides.length === 0) return null;

  const multi = slides.length > 1;
  return (
    <View testID="advertising-carousel">
      <FlatList
        ref={list}
        style={{ height: cardHeight }}
        horizontal
        data={slides}
        keyExtractor={(slide) => slide.key}
        renderItem={({ item }) => <CampaignArtwork slide={item} width={cardWidth} height={cardHeight} onPress={press} />}
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={styles.track}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        onMomentumScrollEnd={settle}
        getItemLayout={(_, i) => ({ length: interval, offset: interval * i, index: i })}
        accessibilityLabel="Advertisements"
      />
      {multi ? (
        <View style={styles.controls} testID="featured-controls">
          <View pointerEvents="none" style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {slides.map((slide, i) => <View key={slide.key} style={[styles.dot, i === current && styles.dotActive]} />)}
          </View>
          <View style={styles.arrows}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous advertisement" hitSlop={6} onPress={() => go(-1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.forest} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next advertisement" hitSlop={6} onPress={() => go(1)} style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.forest} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A campaign is its uploaded artwork and nothing else: no overlay, label, headline or button. The
 * whole card opens the destination; the headline is the accessible name and is never drawn.
 */
function CampaignArtwork({ slide, width, height, onPress }: { slide: FeaturedSlide; width: number; height: number; onPress: (slide: FeaturedSlide) => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={slide.headline}
      onPress={() => onPress(slide)}
      style={[styles.card, { width, height }]}
      testID={`campaign-artwork-${slide.campaignId}`}
    >
      <Image source={{ uri: slide.imageUrl }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} accessibilityIgnoresInvertColors />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { paddingHorizontal: CARD_GUTTER },
  card: { borderRadius: radii.shell, overflow: "hidden", backgroundColor: colors.forestDeep },
  // Below the card, so nothing is drawn over campaign artwork.
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingHorizontal: CARD_GUTTER },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(0,63,58,0.25)" },
  dotActive: { backgroundColor: colors.forest },
  arrows: { flexDirection: "row", gap: 8 },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,63,58,0.08)" },
  arrowPressed: { backgroundColor: "rgba(0,63,58,0.18)" },
});
