import { Image } from "expo-image";
import { router, useIsFocused } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { recordCampaignClick, recordCampaignImpression } from "@/api/home";
import { useFeaturedCampaigns } from "@/api/home-queries";
import { useApi } from "@/api/provider";
import { useReduceMotion } from "@/home/components/logo-rail";
import { useCarouselAutoplay } from "@/home/use-carousel-autoplay";
import { buildFeaturedSlides, NATIVE_CAMPAIGN_ASPECT, rotationMs, type FeaturedSlide, type SlideTarget } from "@/home/featured";
import { openSearch } from "@/marketplace/navigation";
import { colors, radii } from "@/theme/tokens";

const CARD_GUTTER = 16;
const GAP = 16;
/** Impressions are reported once per campaign per app session, like the website carousel. */
const reportedImpressions = new Set<string>();

/**
 * One full advertisement per screen. The card spans the screen minus the 16pt gutters (capped at
 * 560), and the gap between cards equals one gutter, so a snap step of card + gap puts the next
 * card's left edge exactly at the screen's right edge: nothing of it shows at rest.
 */
export function carouselLayout(screenWidth: number) {
  const cardWidth = Math.min(screenWidth - CARD_GUTTER * 2, 560);
  return { gutter: CARD_GUTTER, gap: GAP, cardWidth, cardHeight: Math.round(cardWidth * NATIVE_CAMPAIGN_ASPECT), interval: cardWidth + GAP };
}

export function openSlideTarget(target: SlideTarget) {
  if (target.type === "listing") router.push({ pathname: "/listing/[id]", params: { id: target.id } });
  else if (target.type === "search") openSearch(target.filters);
  else void WebBrowser.openBrowserAsync(target.url);
}

/**
 * The homepage advertising carousel: live campaigns only (see `buildFeaturedSlides`). With no
 * campaign that has artwork, nothing renders, not even a placeholder. Each campaign's artwork is
 * shown exactly as uploaded, uncropped, in a 2.5:1 card (the 1200 x 480 native upload); the dots
 * sit below the card, never over the artwork. There are no arrow buttons: people swipe.
 *
 * It advances on its own every `rotationSeconds` (Super Admin's placement setting, 5 s by default)
 * with a single timer per shown slide. It holds still while a finger is on it, while Home is not
 * the visible screen or the app is in the background (so impressions stay "actually seen"), when
 * the system asks for reduced motion, and when there is only one campaign.
 */
export function FeaturedAdsCarousel() {
  const { api, apiUrl } = useApi();
  const { width } = useWindowDimensions();
  const campaigns = useFeaturedCampaigns();
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== "background");
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const list = useRef<FlatList<FeaturedSlide>>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  const { cardWidth, cardHeight, interval } = carouselLayout(width);
  const delay = rotationMs(campaigns.data?.rotationSeconds);

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
    setIndex(Math.min(slides.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / interval))));
    setDragging(false);
  }

  useCarouselAutoplay({
    count: slides.length,
    current,
    delayMs: delay,
    paused: dragging || !focused || !appActive || reduceMotion,
    onAdvance: (next) => {
      list.current?.scrollToOffset({ offset: next * interval, animated: true });
      setIndex(next);
    },
  });

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
        onScrollBeginDrag={() => setDragging(true)}
        onScrollEndDrag={() => setDragging(false)}
        onMomentumScrollEnd={settle}
        getItemLayout={(_, i) => ({ length: interval, offset: interval * i, index: i })}
        accessibilityLabel="Advertisements"
      />
      {multi ? (
        <View style={styles.controls} testID="featured-controls">
          <View pointerEvents="none" style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {slides.map((slide, i) => <View key={slide.key} testID={i === current ? "featured-dot-active" : "featured-dot"} style={[styles.dot, i === current && styles.dotActive]} />)}
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
  // Neutral page surface: a 2.5:1 upload fills the card; an older 1200 x 792 one sits centred with
  // plain margins, never on a dark NesAfric-made backdrop.
  card: { borderRadius: radii.shell, overflow: "hidden", backgroundColor: colors.surface },
  // Below the card, so nothing is drawn over campaign artwork.
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8, paddingHorizontal: CARD_GUTTER },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(0,63,58,0.25)" },
  dotActive: { backgroundColor: colors.forest },
});
