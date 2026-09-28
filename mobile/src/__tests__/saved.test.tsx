/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import path from "path";
import { StyleSheet } from "react-native";
import type { ReactNode } from "react";

import type { PublicListing } from "@/api/types";
import { parseStoredSaves, SAVE_FAILED_MESSAGE, SavedProvider, useSaved } from "@/marketplace/saved";
import { listing } from "@/test-utils/fixtures";

const APP_DIR = path.join(__dirname, "../app");
const STORAGE_KEY = "nesafric.saved-listings.v1";
const house = listing();
const flat = listing({
  id: "3f1c2a9e-5a55-4a1e-9f1c-000000000003",
  title: "2 Bedroom Apartment",
  category: "APARTMENT",
  pricing: { askingAmountMinor: null, rentAmountMinor: "420000", currencyCode: "GHS", frequency: "MONTHLY" },
  attributes: { bedrooms: 2, bathrooms: "1", sizeSqm: null },
  location: { ...house.location, district: "Osu", city: "Accra" },
  verification: { status: "PENDING" },
  media: [],
});
const gone = listing({ id: "3f1c2a9e-5a55-4a1e-9f1c-000000000004", title: "Withdrawn Townhouse" });

type Call = { url: URL; init: RequestInit };
let calls: Call[];

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

/** The public API: `listings` are live; any other id answers 404 like an unpublished listing. */
function mockApi({ listings = [house, flat], offline = false }: { listings?: PublicListing[]; offline?: boolean } = {}) {
  calls = [];
  const state = { listings, offline };
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (state.offline) return Promise.reject(new TypeError("Network request failed"));
    if (url.pathname === "/api/public/listings") {
      return json(200, { items: state.listings, pagination: { page: 1, pageSize: 20, total: state.listings.length, totalPages: 1 } });
    }
    const detail = url.pathname.match(/^\/api\/public\/listings\/([^/]+)$/);
    const found = detail && state.listings.find((item) => item.id === detail[1]);
    return found ? json(200, { listing: found }) : json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as jest.Mock;
  return state;
}

async function seed(listings: PublicListing[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(listings.map((item, index) => ({ listing: item, savedAt: `2026-09-2${index}T10:00:00.000Z` }))));
}

async function stored() {
  return parseStoredSaves(await AsyncStorage.getItem(STORAGE_KEY)).map((item) => item.listing.id);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("Saved properties screen", () => {
  it("works signed out: an inviting empty state, no sign-in prompt and no account calls", async () => {
    mockApi();
    const app = renderRouter(APP_DIR, { initialUrl: "/saved" });

    expect(await screen.findByText("Save properties you love")).toBeTruthy();
    expect(screen.getByText("Saved properties")).toBeTruthy();
    expect(screen.getByText("Kept on this device — no account needed.")).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(calls.some((call) => /\/api\/(auth|account|workspaces)/.test(call.url.pathname))).toBe(false);
    expect(calls.every((call) => !(call.init.headers as Record<string, string> | undefined)?.authorization)).toBe(true);

    fireEvent.press(screen.getByTestId("saved-explore"));
    await waitFor(() => expect(app.getPathname()).toBe("/search"));
  });

  it("lists saved properties with real listing details only", async () => {
    mockApi();
    await seed([house, flat]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });

    expect(await screen.findByText("2 properties · Kept on this device — no account needed.")).toBeTruthy();
    expect(screen.getByText("GH₵8,500/month")).toBeTruthy();
    expect(screen.getByText("4 Bedroom House")).toBeTruthy();
    expect(screen.getByText("East Legon, Accra")).toBeTruthy();
    expect(screen.getByText("4 Beds · 4 Baths · 320 m²")).toBeTruthy();
    expect(screen.getByText("GH₵4,200/month")).toBeTruthy();
    expect(screen.getByText("2 Beds · 1 Bath")).toBeTruthy();
    // Only the verified listing carries the badge; the unverified one has no photo and says so.
    expect(screen.getAllByLabelText("Verified")).toHaveLength(1);
    expect(screen.getByTestId(`saved-no-photo-${flat.id}`)).toHaveTextContent(/No photos yet/);
    expect(screen.getByLabelText(`Remove ${house.title} from saved`)).toHaveProp("accessibilityState", { selected: true });
  });

  it("updates the saved snapshot when the listing has changed", async () => {
    mockApi({ listings: [{ ...house, pricing: { ...house.pricing, rentAmountMinor: "900000" } }] });
    await seed([house]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });

    expect(await screen.findByText("GH₵9,000/month")).toBeTruthy();
    await waitFor(async () => expect(parseStoredSaves(await AsyncStorage.getItem(STORAGE_KEY))[0].listing.pricing.rentAmountMinor).toBe("900000"));
  });

  it("shows a listing that has left the marketplace as no longer available, and removes it", async () => {
    mockApi({ listings: [house] });
    await seed([gone, house]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });

    expect(await screen.findByTestId(`saved-unavailable-${gone.id}`)).toBeTruthy();
    expect(screen.getByText("No longer available")).toBeTruthy();
    // No stale price or photo is shown for it.
    expect(screen.queryByTestId(`saved-card-${gone.id}`)).toBeNull();

    await act(async () => fireEvent.press(screen.getByTestId(`saved-remove-${gone.id}`)));
    await waitFor(() => expect(screen.queryByTestId(`saved-unavailable-${gone.id}`)).toBeNull());
    expect(await stored()).toEqual([house.id]);
  });

  it("offline, shows the saved details and says so after a refresh", async () => {
    const api = mockApi({ offline: true });
    await seed([house]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });

    expect(await screen.findByText("GH₵8,500/month")).toBeTruthy();
    const refreshControl = screen.getByTestId("saved-list").props.refreshControl;
    await act(async () => refreshControl.props.onRefresh());
    expect(await screen.findByText(/You’re offline\. Showing the details saved on this device/, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByTestId(`saved-card-${house.id}`)).toBeTruthy();

    // Back online: pull to refresh clears the notice.
    api.offline = false;
    await act(async () => screen.getByTestId("saved-list").props.refreshControl.props.onRefresh());
    await waitFor(() => expect(screen.queryByText(/You’re offline/)).toBeNull());
  }, 20_000);

  it("shows a fallback when a photo fails to load", async () => {
    mockApi();
    await seed([house]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });

    await screen.findByTestId(`saved-photo-${house.id}`);
    const photo = screen.UNSAFE_getAllByType(Image).find((node) => node.props.testID === `saved-photo-${house.id}`)!;
    act(() => photo.props.onError({ error: "404" }));
    expect(await screen.findByText("Photo unavailable")).toBeTruthy();
  });

  it("saves from Search, shows it in Saved, and unsaving anywhere updates everywhere", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/search" });

    const heart = await screen.findByLabelText(`Save ${house.title}`);
    await act(async () => fireEvent.press(heart));
    expect(await stored()).toEqual([house.id]);

    act(() => router.navigate("/saved"));
    expect(await screen.findByTestId(`saved-card-${house.id}`)).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByLabelText(`Remove ${house.title} from saved`)));
    expect(await screen.findByText("Save properties you love")).toBeTruthy();
    expect(await stored()).toEqual([]);

    act(() => router.navigate("/search"));
    expect(await screen.findByLabelText(`Save ${house.title}`)).toBeTruthy();
  });

  // Expo Router's `Link asChild` spreads the child's style into an object, so a Pressable style
  // *function* used to vanish: cards had no white surface, border or radius.
  const expectCardSurface = (node: { props: { style?: unknown } }) => {
    const style = StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
    expect(style.backgroundColor).toBe("#ffffff");
    expect(style.borderWidth).toBe(1);
    expect(style.borderRadius).toBe(8);
    expect(style.overflow).toBe("hidden");
  };

  it("Search cards keep their white surface through Link asChild and still open the listing", async () => {
    mockApi();
    const app = renderRouter(APP_DIR, { initialUrl: "/search" });
    await screen.findByLabelText(`Save ${house.title}`);
    const card = screen.getAllByRole("link").find((node) => String(node.props.accessibilityLabel).includes(house.title))!;
    expectCardSurface(card);
    await act(async () => fireEvent.press(card));
    await waitFor(() => expect(app.getPathname()).toBe(`/listing/${house.id}`));
  });

  it("Saved cards keep their white surface through Link asChild", async () => {
    mockApi();
    await seed([house]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    expectCardSurface(await screen.findByTestId(`saved-card-${house.id}`));
  });

  it("opens the listing detail from Saved, and the detail heart agrees with Saved", async () => {
    mockApi();
    await seed([house]);
    const app = renderRouter(APP_DIR, { initialUrl: "/saved" });

    const card = await screen.findByTestId(`saved-card-${house.id}`);
    await act(async () => fireEvent.press(card));
    await waitFor(() => expect(app.getPathname()).toBe(`/listing/${house.id}`));
    expect(await screen.findByText("Key facts")).toBeTruthy();

    // Unsave on the detail screen, go back: Saved is already up to date.
    await act(async () => fireEvent.press(screen.getAllByLabelText(`Remove ${house.title} from saved`).at(-1)!));
    act(() => router.back());
    expect(await screen.findByText("Save properties you love")).toBeTruthy();
    expect(await stored()).toEqual([]);
  });

  it("undoes a change the device couldn't store, and explains", async () => {
    mockApi();
    await seed([house]);
    renderRouter(APP_DIR, { initialUrl: "/saved" });
    await screen.findByTestId(`saved-card-${house.id}`);

    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("disk full")));
    await act(async () => fireEvent.press(screen.getByLabelText(`Remove ${house.title} from saved`)));

    expect(await screen.findByText(SAVE_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId(`saved-card-${house.id}`)).toBeTruthy();
    expect(await stored()).toEqual([house.id]);
    fireEvent.press(screen.getByTestId("saved-dismiss-error"));
    expect(screen.queryByText(SAVE_FAILED_MESSAGE)).toBeNull();
  });
});

describe("saved store", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <SavedProvider>{children}</SavedProvider>;

  it("never saves the same listing twice", async () => {
    const { result } = renderHook(() => useSaved(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.save(house);
      result.current.save(house);
      result.current.toggle(flat);
      result.current.save(flat);
    });
    expect(result.current.items.map((item) => item.listing.id)).toEqual([flat.id, house.id]);
    await waitFor(async () => expect(await stored()).toEqual([flat.id, house.id]));
  });

  it("drops duplicates and corrupt entries from storage", () => {
    const raw = JSON.stringify([{ listing: house, savedAt: "a" }, { listing: house, savedAt: "b" }, { nope: true }, { listing: flat, savedAt: "c" }]);
    expect(parseStoredSaves(raw).map((item) => [item.listing.id, item.savedAt])).toEqual([[house.id, "a"], [flat.id, "c"]]);
    expect(parseStoredSaves("{not json")).toEqual([]);
  });

  it("rolls back a save the device couldn't store", async () => {
    const { result } = renderHook(() => useSaved(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("disk full")));
    act(() => result.current.save(house));
    expect(result.current.isSaved(house.id)).toBe(true);
    await waitFor(() => expect(result.current.isSaved(house.id)).toBe(false));
    expect(result.current.error).toBe(SAVE_FAILED_MESSAGE);
  });
});
