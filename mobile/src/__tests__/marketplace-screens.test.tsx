/// <reference types="node" />
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import { listing } from "@/test-utils/fixtures";

const APP_DIR = path.join(__dirname, "../app");
const house = listing();
const land = listing({ id: "3f1c2a9e-5a55-4a1e-9f1c-000000000002", title: "Half plot at Oyarifa", category: "LAND", media: [] });

type Call = { url: string; init: RequestInit };
let calls: Call[];

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

function mockApi(handlers: { search?: (url: URL) => unknown; lead?: () => [number, unknown]; viewing?: () => [number, unknown] } = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    if (url.pathname === "/api/public/listings") {
      // Mirror the server's rule so a missing country fails here too.
      if (url.searchParams.get("city") && !url.searchParams.get("country")) {
        return json(400, { error: { code: "VALIDATION_ERROR", message: "The request contains invalid input.", issues: [{ path: "country", message: "Country is required for narrower location filters." }] } });
      }
      const items = handlers.search ? handlers.search(url) : [house];
      return json(200, { items, pagination: { page: 1, pageSize: 20, total: (items as unknown[]).length, totalPages: 1 } });
    }
    if (url.pathname === `/api/public/listings/${house.id}`) return json(200, { listing: house });
    if (url.pathname.endsWith("/leads")) return json(...(handlers.lead?.() ?? [201, { id: "a1b2c3d4-0000-4000-8000-000000000001", listingId: house.id, status: "NEW", createdAt: "now" }]));
    if (url.pathname.endsWith("/viewings")) return json(...(handlers.viewing?.() ?? [201, { id: "v1" }]));
    return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as jest.Mock;
}

function keysFor(pathEnd: string) {
  return calls
    .filter((entry) => entry.url.endsWith(pathEnd) && entry.init.method === "POST")
    .map((entry) => (entry.init.headers as Record<string, string>)["idempotency-key"]);
}

function bodyOf(pathEnd: string) {
  const call = calls.find((entry) => entry.url.endsWith(pathEnd) && entry.init.method === "POST");
  return call ? JSON.parse(String(call.init.body)) : undefined;
}

describe("signed-out marketplace", () => {
  it("opens on the marketplace home without asking anyone to sign in", async () => {
    mockApi({ search: (url) => (url.searchParams.get("category") === "LAND" ? [land] : url.searchParams.get("category") ? [] : [house]) });
    renderRouter(APP_DIR, { initialUrl: "/" });

    expect(await screen.findByText("Find your perfect property")).toBeTruthy();
    // With no campaigns the featured carousel shows real published listings.
    expect(await screen.findByText("4 Bedroom House")).toBeTruthy();
    expect(screen.getByText("Search properties")).toBeTruthy();
    expect(screen.getByLabelText("Advanced search")).toBeTruthy();
    expect(screen.queryByText(/sign in to continue/i)).toBeNull();
    // Every request is to a public endpoint, with no credentials.
    expect(calls.every((call) => call.url.startsWith("https://api.test/api/public/") && call.init.credentials === "omit")).toBe(true);
  });

  it("shows property details and saves a property on this device", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: `/listing/${house.id}` });

    expect(await screen.findByText("4 Bedroom House")).toBeTruthy();
    expect(screen.getByText("GH₵8,500/month")).toBeTruthy();
    expect(screen.getByText("4 Beds · 4 Baths · 320 m²")).toBeTruthy();
    expect(screen.getByText("Verified property")).toBeTruthy();
    expect(screen.getByText("ABC Realty (Agent)")).toBeTruthy();
    expect(screen.getByText("Parking")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Save 4 Bedroom House"));
    expect(await screen.findByLabelText("Remove 4 Bedroom House from saved")).toBeTruthy();
  });

  it("sends a guest viewing request only after consent, then confirms", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: `/listing/${house.id}/enquire?mode=viewing` });

    fireEvent.changeText(await screen.findByLabelText("Your name"), "Kofi Mensah");
    fireEvent.changeText(screen.getByLabelText("Phone"), "024 123 4567");
    fireEvent.press(screen.getAllByText("9am–12pm")[0]);
    fireEvent.press(screen.getByTestId("submit-enquiry"));

    expect(await screen.findByText("Please confirm we can share your details with the lister.")).toBeTruthy();
    expect(calls.some((call) => call.init.method === "POST")).toBe(false);

    fireEvent.press(screen.getByTestId("share-consent"));
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));

    expect(await screen.findByText("Viewing request sent")).toBeTruthy();
    expect(bodyOf("/leads")).toEqual({ name: "Kofi Mensah", phone: "024 123 4567", marketingConsent: false, source: "MOBILE_APP_VIEWING" });
    const viewing = bodyOf("/viewings");
    expect(viewing.leadId).toBe("a1b2c3d4-0000-4000-8000-000000000001");
    expect(viewing.preferredTimes).toHaveLength(1);
    expect(new Date(viewing.preferredTimes[0].startsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("tells the guest when the enquiry was sent but the viewing times failed", async () => {
    mockApi({ viewing: () => [422, { error: { code: "VIEWING_TIME_IN_PAST", message: "Preferred viewing times must be in the future." } }] });
    renderRouter(APP_DIR, { initialUrl: `/listing/${house.id}/enquire?mode=viewing` });

    fireEvent.changeText(await screen.findByLabelText("Your name"), "Ama");
    fireEvent.changeText(screen.getByLabelText("Email (optional if you give a phone)"), "ama@example.com");
    fireEvent.press(screen.getAllByText("12–3pm")[0]);
    fireEvent.press(screen.getByTestId("share-consent"));
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));

    expect(await screen.findByText(/reached the lister, but the viewing times didn’t go through|reached the lister, but the viewing times didn't go through/)).toBeTruthy();
  });

  it("surfaces server validation errors on a contact enquiry", async () => {
    mockApi({ lead: () => [400, { error: { code: "VALIDATION_ERROR", message: "The request contains invalid input.", issues: [{ path: "email", message: "Invalid email address" }] } }] });
    renderRouter(APP_DIR, { initialUrl: `/listing/${house.id}/enquire?mode=contact` });

    fireEvent.changeText(await screen.findByLabelText("Your name"), "Ama");
    fireEvent.changeText(screen.getByLabelText("Phone"), "0241234567");
    fireEvent.press(screen.getByTestId("share-consent"));
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));

    await waitFor(() => expect(screen.getByText("Invalid email address")).toBeTruthy());
    expect(screen.getByText("The request contains invalid input.")).toBeTruthy();
  });

  it("sends an idempotency key, reusing it only for an identical retry", async () => {
    let failNext = true;
    mockApi({ lead: () => (failNext ? ((failNext = false), [503, { error: { code: "HTTP_503", message: "Service unavailable" } }]) : [201, { id: "a1b2c3d4-0000-4000-8000-000000000009", listingId: house.id, status: "NEW", createdAt: "now" }]) });
    renderRouter(APP_DIR, { initialUrl: `/listing/${house.id}/enquire?mode=contact` });

    fireEvent.changeText(await screen.findByLabelText("Your name"), "Ama");
    fireEvent.changeText(screen.getByLabelText("Phone"), "0241234567");
    fireEvent.press(screen.getByTestId("share-consent"));
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));
    expect(await screen.findByText("Service unavailable")).toBeTruthy();

    // Identical retry: same key, so the server can replay instead of creating a duplicate lead.
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));
    expect(await screen.findByText("Message sent")).toBeTruthy();
    const [first, second] = keysFor("/leads");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it("uses a new key when the form changes, and explains rate limiting", async () => {
    mockApi({ lead: () => [429, { error: { code: "PUBLIC_WRITE_RATE_LIMITED", message: "Too many requests." } }] });
    renderRouter(APP_DIR, { initialUrl: `/listing/${house.id}/enquire?mode=contact` });

    fireEvent.changeText(await screen.findByLabelText("Your name"), "Ama");
    fireEvent.changeText(screen.getByLabelText("Phone"), "0241234567");
    fireEvent.press(screen.getByTestId("share-consent"));
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));
    expect(await screen.findByText(/sent several requests in a short time/)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("Message (optional)"), "Is parking included?");
    await act(async () => fireEvent.press(screen.getByTestId("submit-enquiry")));
    const [first, second] = keysFor("/leads");
    expect(second).not.toBe(first);
  });
});
