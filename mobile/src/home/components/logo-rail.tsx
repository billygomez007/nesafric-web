import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { HOME_GUTTER } from "./layout";

export const RAIL_TILE = { width: 92, height: 54, gap: 10 };
/** Drift speed in points per second — slow enough to read each logo. */
const SPEED = 16;
/** How long the rail waits after a manual swipe before drifting again. */
const RESUME_AFTER_MS = 2500;
/** Copies rendered while looping: the swipe offset lives in copy 1, the drift adds up to one more. */
const LOOP_COPIES = 4;

/** Maps a scroll offset into the second copy — the same visual position, no jump. */
export function wrapOffset(x: number, setWidth: number) {
  if (setWidth <= 0) return x;
  return setWidth + ((((x - setWidth) % setWidth) + setWidth) % setWidth);
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => active && setReduce(value));
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

/**
 * Horizontal logo rail that drifts slowly, loops seamlessly and can be swiped by hand.
 *
 * The drift is a native-driver `translateX` on the row, never a programmatic scroll. A scroll
 * view that scrolls while a finger is down elsewhere emits `scroll` events, and React Native's
 * responder system then lets the Home ScrollView take over that touch — cancelling every chip,
 * card and button press on the page. The ScrollView here only moves when the user swipes it.
 *
 * Copies of the tiles make the loop seamless in both directions; only one copy is exposed to
 * screen readers. A set that fits on screen, or Reduce Motion, keeps the rail still.
 */
export function LogoRail({
  count,
  renderTile,
  label,
  testID,
}: {
  count: number;
  renderTile: (index: number, key: string, hiddenFromAccessibility: boolean) => ReactNode;
  label: string;
  testID?: string;
}) {
  const ref = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState(0);
  const reduceMotion = useReduceMotion();
  const setWidth = count * (RAIL_TILE.width + RAIL_TILE.gap);
  const loops = viewport > 0 && setWidth > viewport;
  const [drift] = useState(() => new Animated.Value(0));
  const driftAt = useRef(0);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First finishes the current pass (from wherever a swipe left it), then loops natively from 0
  // to one full set to the left: the next copy is then exactly where the first one was, so the
  // restart is invisible.
  const start = useCallback(() => {
    if (!loops || reduceMotion) return;
    const pass = (from: number) =>
      Animated.timing(drift, {
        toValue: -setWidth,
        duration: ((setWidth + from) / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
        // A never-ending animation must not hold an InteractionManager handle open.
        isInteraction: false,
      });
    animation.current = pass(driftAt.current);
    animation.current.start(({ finished }) => {
      if (!finished) return;
      drift.setValue(0);
      animation.current = Animated.loop(pass(0));
      animation.current.start();
    });
  }, [drift, loops, reduceMotion, setWidth]);

  const stop = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    animation.current?.stop();
    drift.stopAnimation((value) => {
      driftAt.current = value;
    });
  }, [drift]);

  useEffect(() => {
    if (loops) {
      ref.current?.scrollTo({ x: setWidth, animated: false });
    } else {
      drift.setValue(0);
      driftAt.current = 0;
    }
    start();
    return stop;
  }, [drift, loops, setWidth, start, stop]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!loops) return;
    // Only after the finger has lifted: re-centre the swipe offset (no visual change) and resume.
    const x = event.nativeEvent.contentOffset.x;
    const wrapped = wrapOffset(x, setWidth);
    if (wrapped !== x) ref.current?.scrollTo({ x: wrapped, animated: false });
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(start, RESUME_AFTER_MS);
  };

  const copies = loops ? LOOP_COPIES : 1;
  return (
    <View onLayout={(event) => setViewport(event.nativeEvent.layout.width)} testID={testID}>
      <ScrollView
        ref={ref}
        horizontal
        accessibilityLabel={label}
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={stop}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={(event) => {
          // A drag without momentum ends here; with momentum, onMomentumScrollEnd settles it.
          const { velocity } = event.nativeEvent;
          if (!velocity || Math.abs(velocity.x) < 0.01) settle(event);
        }}
        contentContainerStyle={!loops && styles.rowStatic}
      >
        <Animated.View testID="logo-rail-row" style={[styles.row, { transform: [{ translateX: drift }] }]}>
          {Array.from({ length: copies }, (_, copy) =>
            Array.from({ length: count }, (_, index) => renderTile(index, `${copy}-${index}`, loops && copy !== 1)),
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Every tile carries its own trailing gap so one set is exactly `count × (width + gap)` wide.
  row: { flexDirection: "row", gap: RAIL_TILE.gap, paddingVertical: 2, paddingRight: RAIL_TILE.gap },
  rowStatic: { paddingLeft: HOME_GUTTER, paddingRight: HOME_GUTTER },
});
