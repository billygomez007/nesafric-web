// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));
vi.mock("@/platform/analytics", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/analytics")>()), trackEvent: vi.fn() }));

import { AccommodationBookingForm } from "@/components/accommodation-booking-form";
import { HeroSearch } from "@/components/marketplace-home/hero-search";
import { ListingCard, type PublicListing } from "@/components/property-marketplace-search";
import { PublicListingDetail } from "@/components/public-listing-detail";
import { trackEvent } from "@/platform/analytics";

const base: PublicListing = {
  id: "3f1c2a9e-5a55-4a1e-9f1c-000000000001", listingType: "RENT", scope: "PROPERTY", category: "HOTEL", title: "Labadi Beach Suites",
  description: "Sea-view suites.", pricing: { askingAmountMinor: null, rentAmountMinor: "95000", currencyCode: "GHS", frequency: "PER_NIGHT" },
  availability: { availableFrom: "2026-01-01", actual: true }, attributes: { bedrooms: 1, bathrooms: "1", sizeSqm: null },
  bookable: true, stay: { maxGuests: 4, minimumNights: 2, checkInTime: "14:00", checkOutTime: "11:00", houseRules: "No parties." },
  location: { countryCode: "GH", region: null, city: "Accra", district: null, locality: "Labadi", label: null, map: { latitude: null, longitude: null, precision: null, geocodingRequired: true } },
  amenities: [], media: [], contact: { name: "Front desk", email: null, phone: null, enquiryEnabled: true },
  verification: { status: "VERIFIED", evidenceReady: true }, attribution: { listedBy: "Hotel", professional: null }, publishedAt: "2026-09-01T00:00:00Z",
};

const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(trackEvent).mockClear();
});

describe("categories", () => {
  it("the homepage offers Hotels, Short stays and Warehouses next to Rent, Buy and Land, each opening filtered search", () => {
    render(<HeroSearch />);
    const labels = screen.getAllByRole("link").map((link) => link.textContent);
    expect(labels.slice(0, 7)).toEqual(["Rent", "Buy", "Land", "Commercial", "Hotels", "Short stays", "Warehouses"]);
    expect(screen.getByRole("link", { name: "Hotels" }).getAttribute("href")).toBe("/marketplace/properties?category=HOTEL");
    expect(screen.getByRole("link", { name: "Short stays" }).getAttribute("href")).toBe("/marketplace/properties?category=SHORT_STAY");
    expect(screen.getByRole("link", { name: "Warehouses" }).getAttribute("href")).toBe("/marketplace/properties?category=WAREHOUSE");
  });

  it("cards label stays by type and price them per night; warehouses keep rent pricing", () => {
    render(<ListingCard listing={base} />);
    expect(screen.getAllByText("Hotel").length).toBeGreaterThan(0);
    expect(screen.queryByText("For rent")).toBeNull();
    expect(screen.getByText(/From/)).toBeTruthy();
    expect(screen.getByText(/night/)).toBeTruthy();
    expect(screen.getByText("Up to 4 guests")).toBeTruthy();
    cleanup();
    render(<ListingCard listing={{ ...base, category: "SHORT_STAY", title: "Osu loft" }} />);
    expect(screen.getAllByText("Short stay").length).toBeGreaterThan(0);
    cleanup();
    render(<ListingCard listing={{ ...base, category: "WAREHOUSE", bookable: false, stay: null, pricing: { ...base.pricing, frequency: "MONTHLY", rentAmountMinor: "1500000" } }} />);
    expect(screen.getByText("For rent")).toBeTruthy();
    expect(screen.getByText(/month/)).toBeTruthy();
    expect(screen.queryByText(/night/)).toBeNull();
  });
});

describe("listing detail", () => {
  it("a hotel shows the booking request, not the property enquiry", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ listing: base }) });
    render(<PublicListingDetail listingId={base.id} />);
    expect(await screen.findByRole("form", { name: /Request a booking/ })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Enquire about this listing" })).toBeNull();
    expect(screen.getByRole("link", { name: "Request booking" }).getAttribute("href")).toBe("#book");
  });

  it("a warehouse keeps the ordinary enquiry", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ listing: { ...base, category: "WAREHOUSE", bookable: false, stay: null } }) });
    render(<PublicListingDetail listingId={base.id} />);
    expect(await screen.findByRole("form", { name: "Enquire about this listing" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: /Request a booking/ })).toBeNull();
  });
});

describe("booking form", () => {
  function fill() {
    fireEvent.change(screen.getByLabelText("Check-in"), { target: { value: inDays(10) } });
    fireEvent.change(screen.getByLabelText("Check-out"), { target: { value: inDays(13) } });
    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Efua Mensah" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "efua@guest.test" } });
  }

  it("shows nights and an estimate, sends only the guest's choices, and says the request was sent — not confirmed", async () => {
    render(<AccommodationBookingForm listing={base} />);
    fill();
    expect(screen.getByTestId("booking-nights").textContent).toContain("3 nights");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ reference: "NB-7K3Q9D", status: "REQUESTED", listingTitle: base.title, checkIn: inDays(10), checkOut: inDays(13), nights: 3, adults: 2, children: 0 }) });
    fireEvent.click(screen.getByRole("button", { name: "Request booking" }));
    const sent = await screen.findByTestId("booking-sent");
    expect(sent.textContent).toContain("Booking request sent");
    expect(sent.textContent).toContain("has been sent to the property");
    expect(sent.textContent).toContain("NB-7K3Q9D");
    expect(sent.textContent).not.toMatch(/is confirmed|reservation is confirmed/i);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/public/listings/${base.id}/bookings`);
    expect(init.headers["idempotency-key"]).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ checkIn: inDays(10), checkOut: inDays(13), adults: 2, children: 0, name: "Efua Mensah", email: "efua@guest.test" });
    // Analytics get the category and nights, never the guest's details.
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toMatch(/Efua|guest\.test/);
    expect(vi.mocked(trackEvent)).toHaveBeenCalledWith("accommodation_booking_submitted", expect.objectContaining({ nights: 3 }));
  });

  it("stops a stay shorter than the minimum, or too many guests, before sending", async () => {
    render(<AccommodationBookingForm listing={base} />);
    fill();
    // The date inputs' own min/max already stop this in a browser; submitting directly checks the
    // form's second guard (and the server checks again).
    fireEvent.change(screen.getByLabelText("Check-out"), { target: { value: inDays(11) } });
    fireEvent.submit(screen.getByRole("form", { name: /Request a booking/ }));
    expect(await screen.findByText(/at least 2 nights/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Check-out"), { target: { value: inDays(13) } });
    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Children"), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("form", { name: /Request a booking/ }));
    await waitFor(() => expect(screen.getByText(/up to 4 guests/)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a request is refused", async () => {
    render(<AccommodationBookingForm listing={base} />);
    fill();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "INVALID_BOOKING", message: "This property has a 2-night minimum stay." } }) });
    fireEvent.click(screen.getByRole("button", { name: "Request booking" }));
    expect(await screen.findByText(/2-night minimum stay/)).toBeTruthy();
    expect(screen.queryByTestId("booking-sent")).toBeNull();
  });
});
