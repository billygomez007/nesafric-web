import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Branded backdrop for Home: a warm ivory base, forest and gold washes toward the edges, a
 * fine-line architectural skyline behind the header and one soft building plane at the lower
 * left. The linework is strongest behind the header, hero and search; below them it fades out
 * (the plane and its edges fade downward), so the lower sections read on a clean ivory. Strong enough to read on a real phone, while every text sits on forest-on-ivory
 * contrast of 10:1 or more (body text sits on white surfaces). Everything is static native
 * drawing (views + `experimental_backgroundImage` gradients) — no image asset, no animation.
 *
 * It sits fixed behind the scrolling content and never takes touches (`pointerEvents: "none"`),
 * so it cannot interfere with chips, rails, cards, buttons or scrolling.
 */
export const HOME_BACKGROUND = {
  base: "#f7f4ec",
  /** Forest #003f3a and gold #c99a45 at low alpha. */
  forestWashTop: "rgba(0, 63, 58, 0.08)",
  forestWashBottom: "rgba(0, 63, 58, 0.04)",
  goldWash: "rgba(201, 154, 69, 0.16)",
  line: "rgba(0, 63, 58, 0.14)",
  horizon: "rgba(201, 154, 69, 0.55)",
  /** Lower-left facade: each value fades to 0 downward. */
  planeFill: "rgba(0, 63, 58, 0.022)",
  planeLine: "rgba(0, 63, 58, 0.06)",
  planeAccent: "rgba(201, 154, 69, 0.14)",
} as const;

// The skyline in a 260×110 box: [left, width, height] per building.
const BUILDINGS: [number, number, number][] = [
  [0, 28, 46],
  [32, 38, 78],
  [74, 24, 58],
  [102, 46, 110],
  [152, 30, 66],
  [186, 42, 92],
  [232, 28, 52],
];
const SKYLINE_HEIGHT = 110;
/** Where the horizon sits below the top safe-area inset: just above the search pill. */
const HORIZON_BELOW_INSET = 94;

export function HomePremiumBackground() {
  const { top } = useSafeAreaInsets();
  return (
    <View style={styles.root} testID="home-premium-background" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[StyleSheet.absoluteFill, styles.topWash]} />
      <View style={[StyleSheet.absoluteFill, styles.goldWash]} />
      <View style={[StyleSheet.absoluteFill, styles.bottomWash]} />
      {/* A tall facade plane in perspective, mostly behind the lower sections. */}
      <View style={styles.plane}>
        <View style={styles.planeEdge} />
        <View style={styles.planeInner} />
      </View>
      <View style={[styles.skyline, { top: top + HORIZON_BELOW_INSET - SKYLINE_HEIGHT }]} testID="home-skyline">
        {BUILDINGS.map(([left, width, height], i) => (
          <View key={i} style={[styles.building, { left, width, height }]}>
            {/* A mullion on the taller blocks — reads as architecture, not decoration. */}
            {height > 70 ? <View style={styles.mullion} /> : null}
          </View>
        ))}
        <View style={styles.horizon} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none", backgroundColor: HOME_BACKGROUND.base },
  // A breath of forest across the header/hero, gone by the carousel.
  topWash: { experimental_backgroundImage: `linear-gradient(180deg, ${HOME_BACKGROUND.forestWashTop} 0%, rgba(0, 63, 58, 0) 40%)` },
  // Warm gold light from the top-right corner.
  goldWash: { experimental_backgroundImage: `linear-gradient(215deg, ${HOME_BACKGROUND.goldWash} 0%, rgba(201, 154, 69, 0) 46%)` },
  // Grounds the bottom of the screen above the tab bar.
  bottomWash: { experimental_backgroundImage: `linear-gradient(0deg, ${HOME_BACKGROUND.forestWashBottom} 0%, rgba(0, 63, 58, 0) 30%)` },
  // Behind the upper-right header and hero; content scrolls over it.
  skyline: { position: "absolute", right: -10, width: 260, height: SKYLINE_HEIGHT + 1 },
  building: {
    position: "absolute",
    bottom: 1,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: HOME_BACKGROUND.line,
    alignItems: "center",
  },
  mullion: { width: 1, flex: 1, marginVertical: 10, backgroundColor: HOME_BACKGROUND.line },
  horizon: {
    position: "absolute",
    left: -40,
    right: 0,
    bottom: -0.5,
    height: 1.5,
    experimental_backgroundImage: `linear-gradient(90deg, rgba(201, 154, 69, 0) 0%, ${HOME_BACKGROUND.horizon} 45%, ${HOME_BACKGROUND.horizon} 100%)`,
  },
  // Only the slanted top edge is a full line; the fill and the vertical edges fade downward.
  plane: {
    position: "absolute",
    left: -120,
    bottom: 40,
    width: 230,
    height: 320,
    borderTopWidth: 1,
    borderColor: HOME_BACKGROUND.planeLine,
    experimental_backgroundImage: `linear-gradient(180deg, ${HOME_BACKGROUND.planeFill} 0%, rgba(0, 63, 58, 0) 75%)`,
    transform: [{ skewY: "-14deg" }],
  },
  planeEdge: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 1,
    experimental_backgroundImage: `linear-gradient(180deg, ${HOME_BACKGROUND.planeLine} 0%, rgba(0, 63, 58, 0) 70%)`,
  },
  // A gold floor line a little inside the plane, fading as it descends.
  planeInner: {
    position: "absolute",
    top: 22,
    right: 18,
    bottom: 22,
    width: 1,
    experimental_backgroundImage: `linear-gradient(180deg, ${HOME_BACKGROUND.planeAccent} 0%, rgba(201, 154, 69, 0) 65%)`,
  },
});
