import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, StyleSheet, View } from "react-native";

import { HOME_GUTTER } from "./layout";

export const RAIL_TILE = { width: 92, height: 54, gap: 10 };
/** Drift speed in points per second — slow enough to read each logo. */
const SPEED = 16;
/** How long the rail waits after a manual swipe before drifting again. */
const RESUME_AFTER_MS = 2500;

/** Maps a scroll offset into the middle of three copies — the same visual position, no jump. */
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
 * Horizontal logo rail that drifts slowly and loops seamlessly, and can be swiped by hand.
 *
 * When one set of tiles is wider than the screen, three copies are rendered and the offset is
 * kept inside the middle copy, so the loop has no visible seam in either swipe direction. The
 * outer copies are hidden from screen readers. A set that fits on screen simply sits still, and
 * so does the rail when the user has Reduce Motion on.
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
  const offset = useRef(0);
  const paused = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loops) return;
    offset.current = setWidth;
    ref.current?.scrollTo({ x: setWidth, animated: false });
    if (reduceMotion) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (last && !paused.current) {
        offset.current = wrapOffset(offset.current + (SPEED * (time - last)) / 1000, setWidth);
        ref.current?.scrollTo({ x: offset.current, animated: false });
      }
      last = time;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [loops, reduceMotion, setWidth]);

  useEffect(() => () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }, []);

  const hold = () => {
    paused.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  };

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!loops) return;
    const x = event.nativeEvent.contentOffset.x;
    offset.current = wrapOffset(x, setWidth);
    if (offset.current !== x) ref.current?.scrollTo({ x: offset.current, animated: false });
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      paused.current = false;
    }, RESUME_AFTER_MS);
  };

  const copies = loops ? 3 : 1;
  return (
    <View onLayout={(event) => setViewport(event.nativeEvent.layout.width)} testID={testID}>
      <ScrollView
        ref={ref}
        horizontal
        accessibilityLabel={label}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScrollBeginDrag={hold}
        onScrollEndDrag={settle}
        onMomentumScrollEnd={settle}
        contentContainerStyle={[styles.row, !loops && styles.rowStatic]}
      >
        {Array.from({ length: copies }, (_, copy) =>
          Array.from({ length: count }, (_, index) => renderTile(index, `${copy}-${index}`, loops && copy !== 1)),
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Every tile carries its own trailing gap so one set is exactly `count × (width + gap)` wide.
  row: { gap: RAIL_TILE.gap, paddingVertical: 2, paddingRight: RAIL_TILE.gap },
  rowStatic: { paddingLeft: HOME_GUTTER, paddingRight: HOME_GUTTER },
});
