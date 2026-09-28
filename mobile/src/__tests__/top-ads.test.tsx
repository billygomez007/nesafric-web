/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { listing } from "@/test-utils/fixtures";

const APP_DIR = path.join(__dirname, "../app");
const pinned = listing({ id: "3f1c2a9e-5a55-4a1e-9f1c-0000000000a1", title: "Pinned Villa in East Legon", isTopAd: true });
const organic = listing({ id: "3f1c2a9e-5a55-4a1e-9f1c-0000000000a2", title: "Organic Flat in Osu" });

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

function mockApi() {
  globalThis.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    // The server decides the order and the flag; the app renders it as-is.
    if (url.pathname === "/api/public/listings") return json(200, { items: [pinned, organic], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } });
    return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as jest.Mock;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("Top Ads in the mobile property marketplace", () => {
  it("renders a Top Ad first, as a normal property card with a small truthful label, and only once", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/search" });
    const cards = await screen.findAllByRole("link", { name: /Pinned Villa in East Legon|Organic Flat in Osu/ });
    expect(cards.map((card) => card.props.accessibilityLabel)).toEqual([
      expect.stringMatching(/^Top Ad, .*Pinned Villa in East Legon/),
      expect.not.stringContaining("Top Ad"),
    ]);
    expect(screen.getAllByTestId("top-ad-badge")).toHaveLength(1);
    expect(screen.getAllByText("Pinned Villa in East Legon")).toHaveLength(1);
  });

  it("an organic listing is never labelled as a Top Ad", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/search" });
    const organicCard = await screen.findByRole("link", { name: /Organic Flat in Osu/ });
    expect(organicCard.props.accessibilityLabel).not.toContain("Top Ad");
  });

  it("saving a Top Ad keeps the home, not its placement", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/search" });
    await screen.findByRole("link", { name: /Pinned Villa in East Legon/ });
    await act(async () => fireEvent.press(screen.getByLabelText("Save Pinned Villa in East Legon")));
    await waitFor(async () => expect(await AsyncStorage.getAllKeys()).not.toHaveLength(0));
    const stored = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([, value]) => value ?? "").join("");
    expect(stored).toContain(pinned.id);
    expect(stored).not.toContain("isTopAd");
  });
});
