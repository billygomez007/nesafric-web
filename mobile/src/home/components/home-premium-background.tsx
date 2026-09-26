import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Quiet branded backdrop for Home: a warm ivory base, faint forest and gold washes at the edges,
 * and a hairline architectural skyline tucked behind the header. Everything is static native
 * drawing (views + `experimental_backgroundImage` gradients) — no image asset, no animation.
 *
 * It sits fixed behind the scrolling content and never takes touches (`pointerEvents: "none"`),
 * so it cannot interfere with chips, rails, cards, buttons or scrolling.
 */
export const HOME_BACKGROUND = {
  base: "#faf8f3",
  /** Forest #003f3a and gold #c99a45 at low alpha. */
  forestWashTop: "rgba(0, 63, 58, 0.045)",
  forestWashBottom: "rgba(0, 63, 58, 0.035)",
  goldWash: "rgba(201, 154, 69, 0.10)",
  line: "rgba(0, 63, 58, 0.075)",
  horizon: "rgba(201, 154, 69, 0.32)",
} as const;

// A low skyline in a 240×112 box: [left, width, height] per building.
const BUILDINGS: [number, number, number][] = [
  [0, 26, 44],
  [30, 34, 74],
  [68, 22, 56],
  [94, 42, 112],
  [140, 28, 64],
  [172, 38, 90],
  [214, 26, 50],
];

export function HomePremiumBackground() {
  const { top } = useSafeAreaInsets();
  return (
    <View style={styles.root} testID="home-premium-background" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[StyleSheet.absoluteFill, styles.topWash]} />
      <View style={[StyleSheet.absoluteFill, styles.goldWash]} />
      <View style={[StyleSheet.absoluteFill, styles.bottomWash]} />
      <View style={[styles.skyline, { top: top + 2 }]}>
        {BUILDINGS.map(([left, width, height], i) => (
          <View key={i} style={[styles.building, { left, width, height }]}>
            {/* A single mullion on the taller blocks — reads as architecture, not decoration. */}
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
  topWash: { experimental_backgroundImage: `linear-gradient(180deg, ${HOME_BACKGROUND.forestWashTop} 0%, rgba(0, 63, 58, 0) 32%)` },
  // Warm gold light from the top-right corner.
  goldWash: { experimental_backgroundImage: `linear-gradient(215deg, ${HOME_BACKGROUND.goldWash} 0%, rgba(201, 154, 69, 0) 38%)` },
  // Grounds the bottom of the screen above the tab bar.
  bottomWash: { experimental_backgroundImage: `linear-gradient(0deg, ${HOME_BACKGROUND.forestWashBottom} 0%, rgba(0, 63, 58, 0) 26%)` },
  // Behind the header band, just under the status bar; content scrolls over it.
  skyline: { position: "absolute", right: -8, width: 240, height: 113 },
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
    bottom: 0,
    height: 1,
    experimental_backgroundImage: `linear-gradient(90deg, rgba(201, 154, 69, 0) 0%, ${HOME_BACKGROUND.horizon} 45%, ${HOME_BACKGROUND.horizon} 100%)`,
  },
});
