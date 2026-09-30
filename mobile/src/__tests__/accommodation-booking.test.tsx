/// <reference types="node" />
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import type { PublicListing } from "@/api/types";
import { HOME_CATEGORIES } from "@/home/components/category-chips";
import { addDays, emptyBooking, isoDay, toBookingInput, validateBooking } from "@/marketplace/booking";
import { formatListingPrice } from "@/marketplace/format";
import { priceUnitsFor } from "@/marketplace/price-units";
import { listing } from "@/test-utils/fixtures";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

const APP_DIR = path.join(__dirname, "../app");

const hotel: PublicListing = listing({
  id: "3f1c2a9e-5a55-4a1e-9f1c-0000000000b1",
  category: "HOTEL",
  title: "Labadi Beach Suites",
  pricing: { askingAmountMinor: null, rentAmountMinor: "95000", currencyCode: "GHS", frequency: "PER_NIGHT" },
  bookable: true,
  stay: { maxGuests: 4, minimumNights: 2, checkInTime: "14:00", checkOutTime: "11:00", houseRules: "No parties." },
});
const warehouse: PublicListing = listing({
  id: "3f1c2a9e-5a55-4a1e-9f1c-0000000000b2",
  category: "WAREHOUSE",
  title: "Tema Logistics Warehouse",
  pricing: { askingAmountMinor: null, rentAmountMinor: "1500000", currencyCode: "GHS", frequency: "MONTHLY" },
  bookable: false,
  stay: null,
});

type Call = { url: URL; method: string; body?: unknown; headers?: Record<string, string> };
let calls: Call[];

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}

function mockApi() {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    if (url.pathname === "/api/public/campaigns") return json(200, { banners: [] });
    if (url.pathname === "/api/public/homepage-companies") return json(200, { items: [] });
    if (url.pathname === "/api/public/listings") return json(200, { items: [hotel, warehouse], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } });
    if (url.pathname === `/api/public/listings/${hotel.id}`) return json(200, { listing: hotel });
    if (url.pathname === `/api/public/listings/${warehouse.id}`) return json(200, { listing: warehouse });
    if (url.pathname === `/api/public/listings/${hotel.id}/bookings`) {
      const body = JSON.parse(String(init.body));
      return json(201, { reference: "NB-7K3Q9D", status: "REQUESTED", listingId: hotel.id, listingTitle: hotel.title, checkIn: body.checkIn, checkOut: body.checkOut, nights: 2, adults: body.adults, children: body.children, createdAt: new Date().toISOString() });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }) as jest.Mock;
}

const searchCalls = () => calls.filter((call) => call.url.pathname === "/api/public/listings").map((call) => call.url.searchParams);

describe("accommodation categories", () => {
  it("Hotels, Short stays and Warehouses sit with Rent, Buy, Land and Commercial", () => {
    expect(HOME_CATEGORIES.slice(0, 7).map((category) => category.label)).toEqual(["Hotels", "Short stays", "Rent", "Buy", "Land", "Commercial", "Warehouses"]);
  });

  it.each([["Hotels", "HOTEL"], ["Short stays", "SHORT_STAY"], ["Warehouses", "WAREHOUSE"]])("the %s chip opens Search filtered to %s", async (label, category) => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: "/" });
    fireEvent.press(await screen.findByLabelText(label));
    await waitFor(() => expect(searchCalls().some((params) => params.get("category") === category && params.get("pageSize") === "20")).toBe(true));
  });

  it("stays are priced per night; only stays are", () => {
    expect(formatListingPrice(hotel)).toBe("GH₵950/night");
    expect(priceUnitsFor("RENT", "HOTEL")).toEqual(["PER_NIGHT"]);
    expect(priceUnitsFor("RENT", "SHORT_STAY")).toEqual(["PER_NIGHT"]);
    expect(priceUnitsFor("RENT", "WAREHOUSE")).not.toContain("PER_NIGHT");
  });
});

describe("listing detail", () => {
  it("a hotel's main action is Request booking, not the viewing request", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: `/listing/${hotel.id}` });
    expect(await screen.findByTestId("request-booking")).toBeTruthy();
    expect(screen.getByTestId("contact-property")).toBeTruthy();
    expect(screen.queryByTestId("schedule-viewing")).toBeNull();
    expect(screen.getByText("Stay details")).toBeTruthy();
    expect(screen.getByText("Up to 4")).toBeTruthy();
  });

  it("a warehouse keeps Contact agent and Schedule viewing", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: `/listing/${warehouse.id}` });
    expect(await screen.findByTestId("schedule-viewing")).toBeTruthy();
    expect(screen.getByTestId("contact-agent")).toBeTruthy();
    expect(screen.queryByTestId("request-booking")).toBeNull();
  });
});

describe("booking request", () => {
  it("chooses dates and guests, sends only the guest's choices, and says the request was sent — not confirmed", async () => {
    mockApi();
    const app = renderRouter(APP_DIR, { initialUrl: `/listing/${hotel.id}` });
    fireEvent.press(await screen.findByTestId("request-booking"));
    await waitFor(() => expect(app.getPathname()).toBe(`/listing/${hotel.id}/book`));

    const checkIn = addDays(isoDay(new Date()), 5);
    fireEvent.press(await screen.findByTestId(`check-in-${checkIn}`));
    // Minimum stay is 2 nights: the stepper can't go below it.
    expect(screen.getByTestId("nights-value")).toHaveTextContent("2");
    expect(screen.getByTestId("nights-less")).toHaveProp("accessibilityState", expect.objectContaining({ disabled: true }));
    fireEvent.press(screen.getByTestId("adults-more"));
    fireEvent.press(screen.getByTestId("children-more"));
    expect(screen.getByTestId("check-out-summary")).toHaveTextContent(/Check-out/);
    fireEvent.changeText(screen.getByTestId("booking-name"), "Efua Mensah");
    fireEvent.changeText(screen.getByTestId("booking-email"), "efua@guest.test");
    await act(async () => fireEvent.press(screen.getByTestId("submit-booking")));

    const sent = await screen.findByTestId("booking-sent");
    expect(sent).toHaveTextContent(/Booking request sent/);
    expect(sent).toHaveTextContent(/has been sent to the property/);
    expect(sent).toHaveTextContent(/NB-7K3Q9D/);
    expect(sent).not.toHaveTextContent(/is confirmed/);

    const post = calls.find((call) => call.method === "POST" && call.url.pathname.endsWith("/bookings"))!;
    expect(post.body).toEqual({ checkIn, checkOut: addDays(checkIn, 2), adults: 2, children: 1, name: "Efua Mensah", email: "efua@guest.test" });
    expect(post.headers?.["idempotency-key"]).toBeTruthy();
  });

  it("asks for a check-in day and contact details before sending anything", async () => {
    mockApi();
    renderRouter(APP_DIR, { initialUrl: `/listing/${hotel.id}/book` });
    await act(async () => fireEvent.press(await screen.findByTestId("submit-booking")));
    expect(await screen.findByText("Choose a check-in day.")).toBeTruthy();
    expect(screen.getByText("Enter your full name.")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});

describe("booking rules (mirror of the server)", () => {
  it("enforces minimum nights and guest capacity, and builds the request from the chosen day", () => {
    const form = { ...emptyBooking(hotel), checkIn: "2026-11-02", name: "Efua", email: "efua@guest.test" };
    expect(form.nights).toBe(2);
    expect(validateBooking({ ...form, nights: 1 }, hotel).nights).toMatch(/2-night minimum/);
    expect(validateBooking({ ...form, adults: 4, children: 1 }, hotel).guests).toMatch(/up to 4 guests/);
    expect(validateBooking({ ...form, nights: 91 }, hotel).nights).toMatch(/at most 90/);
    expect(validateBooking(form, hotel)).toEqual({});
    expect(toBookingInput({ ...form, nights: 3, phone: " ", specialRequest: "" })).toEqual({ checkIn: "2026-11-02", checkOut: "2026-11-05", adults: 1, children: 0, name: "Efua", email: "efua@guest.test" });
  });
});
