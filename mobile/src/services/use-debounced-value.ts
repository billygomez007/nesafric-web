import { useCallback, useEffect, useState } from "react";

/** Search as-you-type: the value settles `delayMs` after the last change before it is used. */
export const SEARCH_DEBOUNCE_MS = 400;

/** Returns the settled value and `flush`, which settles the current value at once (e.g. on submit). */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  const flush = useCallback(() => setSettled(value), [value]);
  return [settled, flush] as const;
}
