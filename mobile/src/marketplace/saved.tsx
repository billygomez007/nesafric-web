import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { PublicListing } from "@/api/types";

/**
 * Saved properties, kept on this device only. There is no favourites API on the server yet, so
 * saves work without an account and do not sync between devices (see docs/mobile-saved-properties.md).
 * A snapshot of each listing is stored so the Saved tab still renders offline; the snapshot is
 * refreshed whenever newer public data for that listing is loaded.
 */
const STORAGE_KEY = "nesafric.saved-listings.v1";
const MAX_SAVED = 200;

export type SavedListing = { listing: PublicListing; savedAt: string };

export const SAVE_FAILED_MESSAGE = "Couldn’t update your saved properties on this device. Please try again.";

type SavedContextValue = {
  ready: boolean;
  items: SavedListing[];
  isSaved: (listingId: string) => boolean;
  /** Adds the listing if it isn't saved yet (never duplicates). */
  save: (listing: PublicListing) => void;
  remove: (listingId: string) => void;
  toggle: (listing: PublicListing) => void;
  /** Replaces the stored snapshot of an already-saved listing with newer public data. */
  refreshSnapshot: (listing: PublicListing) => void;
  /** Set when a change couldn't be written to device storage (the change is undone). */
  error: string | null;
  dismissError: () => void;
};

const SavedContext = createContext<SavedContextValue | null>(null);

/** Tolerates corrupt storage and drops duplicates (first occurrence wins). */
export function parseStoredSaves(raw: string | null): SavedListing[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((item) => {
      const id = item?.listing?.id;
      if (typeof id !== "string" || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return [];
  }
}

export function SavedProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SavedListing[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<SavedListing[]>([]);
  // Writes are chained so a slow write can never land after a newer one.
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => parseStoredSaves(raw))
      .catch(() => [])
      .then((loaded) => {
        current.current = loaded;
        setItems(loaded);
        setReady(true);
      });
  }, []);

  /** Applies a change immediately, persists it, and undoes it if the device refuses the write. */
  const commit = useCallback((update: (list: SavedListing[]) => SavedListing[], { silent = false } = {}) => {
    const previous = current.current;
    const next = update(previous);
    if (next === previous) return;
    current.current = next;
    setItems(next);
    writes.current = writes.current.then(() =>
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
        // Only roll back if nothing newer has been applied since.
        if (current.current !== next) return;
        current.current = previous;
        setItems(previous);
        if (!silent) setError(SAVE_FAILED_MESSAGE);
      }),
    );
  }, []);

  const save = useCallback(
    (listing: PublicListing) =>
      commit((list) => (list.some((item) => item.listing.id === listing.id) ? list : [{ listing, savedAt: new Date().toISOString() }, ...list].slice(0, MAX_SAVED))),
    [commit],
  );

  const remove = useCallback((listingId: string) => commit((list) => (list.some((item) => item.listing.id === listingId) ? list.filter((item) => item.listing.id !== listingId) : list)), [commit]);

  const toggle = useCallback(
    (listing: PublicListing) => (current.current.some((item) => item.listing.id === listing.id) ? remove(listing.id) : save(listing)),
    [remove, save],
  );

  const refreshSnapshot = useCallback(
    (listing: PublicListing) =>
      commit(
        (list) => {
          const index = list.findIndex((item) => item.listing.id === listing.id);
          if (index < 0 || JSON.stringify(list[index].listing) === JSON.stringify(listing)) return list;
          const next = [...list];
          next[index] = { ...list[index], listing };
          return next;
        },
        // A background refresh failing to write is not worth interrupting the user for.
        { silent: true },
      ),
    [commit],
  );

  const dismissError = useCallback(() => setError(null), []);

  const value = useMemo<SavedContextValue>(
    () => ({ ready, items, save, remove, toggle, refreshSnapshot, error, dismissError, isSaved: (listingId) => items.some((item) => item.listing.id === listingId) }),
    [ready, items, save, remove, toggle, refreshSnapshot, error, dismissError],
  );

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const context = useContext(SavedContext);
  if (!context) throw new Error("useSaved must be used inside <SavedProvider>.");
  return context;
}
