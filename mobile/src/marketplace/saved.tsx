import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { PublicListing } from "@/api/types";

/**
 * Saved properties, kept on this device only (no account yet). A snapshot of each listing is stored
 * so the Saved tab still renders offline; details are re-fetched when opened.
 */
const STORAGE_KEY = "nesafric.saved-listings.v1";
const MAX_SAVED = 200;

export type SavedListing = { listing: PublicListing; savedAt: string };

type SavedContextValue = {
  ready: boolean;
  items: SavedListing[];
  isSaved: (listingId: string) => boolean;
  toggle: (listing: PublicListing) => void;
};

const SavedContext = createContext<SavedContextValue | null>(null);

export function parseStoredSaves(raw: string | null): SavedListing[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.listing?.id === "string") : [];
  } catch {
    return [];
  }
}

export function SavedProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SavedListing[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => setItems(parseStoredSaves(raw)))
      .catch(() => setItems([]))
      .finally(() => setReady(true));
  }, []);

  const toggle = useCallback((listing: PublicListing) => {
    setItems((current) => {
      const exists = current.some((item) => item.listing.id === listing.id);
      const next = exists
        ? current.filter((item) => item.listing.id !== listing.id)
        : [{ listing, savedAt: new Date().toISOString() }, ...current].slice(0, MAX_SAVED);
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo<SavedContextValue>(
    () => ({ ready, items, toggle, isSaved: (listingId) => items.some((item) => item.listing.id === listingId) }),
    [ready, items, toggle],
  );

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const context = useContext(SavedContext);
  if (!context) throw new Error("useSaved must be used inside <SavedProvider>.");
  return context;
}
