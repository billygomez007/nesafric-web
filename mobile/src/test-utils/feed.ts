import { act, fireEvent, screen } from "@testing-library/react-native";

type TestNode = { props: Record<string, unknown>; parent: TestNode | null };
/** A cell of the feed itself, not of a horizontal rail nested inside it. */
function ownCell(node: TestNode, feed: TestNode) {
  for (let parent = node.parent; parent && parent !== feed; parent = parent.parent) if (parent.props.horizontal === true) return false;
  return true;
}

/**
 * Scrolls the virtualised feed to the end, as a person would, so its lower sections mount. The
 * test renderer has no layout engine, so this sends the layout events a device would: the list's
 * size, each mounted cell's frame (400pt apiece), then a scroll one screen further down per
 * round, so every section passes through the window on the way to the end.
 */
export async function scrollFeed({ rounds = 12, afterEachRound }: { rounds?: number; afterEachRound?: () => void } = {}) {
  const feed = await screen.findByTestId("home-feed");
  for (let round = 0; round < rounds; round += 1) {
    act(() => {
      fireEvent(feed, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } } });
      const cells = feed.findAll((node) => typeof node.props.onLayout === "function" && typeof node.props.onFocusCapture === "function" && ownCell(node, feed));
      cells.forEach((cell, index) => fireEvent(cell, "layout", { nativeEvent: { layout: { x: 0, y: 400 * index, width: 390, height: 400 } } }));
      const height = Math.max(1600, 400 * (cells.length + 1));
      fireEvent(feed, "contentSizeChange", 390, height);
      const offset = Math.min(height - 800, (round + 1) * 800);
      fireEvent.scroll(feed, { nativeEvent: { contentOffset: { x: 0, y: offset }, contentSize: { width: 390, height }, layoutMeasurement: { width: 390, height: 800 } } });
    });
    // The list batches cell updates on a short timer (fake timers under renderRouter).
    act(() => jest.advanceTimersByTime(100));
    // Let newly mounted sections' requests resolve before the caller looks.
    await act(async () => {});
    afterEachRound?.();
  }
}
