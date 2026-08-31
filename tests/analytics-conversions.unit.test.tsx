// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const trackEvent = vi.fn();
vi.mock("@/platform/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/analytics")>();
  return { ...actual, trackEvent };
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("Phase 2 GA4 business-conversion events", () => {
  beforeEach(() => {
    trackEvent.mockClear();
    push.mockClear();
    refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("AuthForm (sign_up / login)", () => {
    it("fires sign_up exactly once after a successful registration, never before", async () => {
      const { AuthForm } = await import("@/components/auth-form");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: "user-1" }));
      const user = userEvent.setup();
      render(<AuthForm mode="register" />);
      await user.type(screen.getByLabelText("Name"), "Ama");
      await user.type(screen.getByLabelText("Email"), "ama@example.com");
      await user.type(screen.getByLabelText("Password"), "a-very-long-password");
      expect(trackEvent).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Create account" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"));
      expect(trackEvent).toHaveBeenCalledTimes(1);
      expect(trackEvent).toHaveBeenCalledWith("sign_up", { method: "email" });
    });

    it("does not fire sign_up when registration fails", async () => {
      const { AuthForm } = await import("@/components/auth-form");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { message: "Email already registered." } }, false));
      const user = userEvent.setup();
      render(<AuthForm mode="register" />);
      await user.type(screen.getByLabelText("Name"), "Ama");
      await user.type(screen.getByLabelText("Email"), "ama@example.com");
      await user.type(screen.getByLabelText("Password"), "a-very-long-password");
      await user.click(screen.getByRole("button", { name: "Create account" }));
      await screen.findByText("Email already registered.");
      expect(trackEvent).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });

    it("fires login exactly once on success, and never on a rapid double submit", async () => {
      const { AuthForm } = await import("@/components/auth-form");
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "user-1" }));
      const user = userEvent.setup();
      render(<AuthForm mode="login" />);
      await user.type(screen.getByLabelText("Email"), "ama@example.com");
      await user.type(screen.getByLabelText("Password"), "password123");
      const button = screen.getByRole("button", { name: "Sign in" });
      await user.dblClick(button);
      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(trackEvent).toHaveBeenCalledTimes(1);
      expect(trackEvent).toHaveBeenCalledWith("login", { method: "email" });
      // The double-click's second request never went out — the submit button disables itself.
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("OnboardingForm (onboarding_completed — manage_properties)", () => {
    it("fires onboarding_completed exactly once, only after the organisation is actually created", async () => {
      const { OnboardingForm } = await import("@/components/onboarding-form");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: "org-1" }));
      const user = userEvent.setup();
      render(<OnboardingForm />);
      await user.type(screen.getByLabelText("Organisation name"), "Ama Properties");
      await user.click(screen.getByRole("button", { name: "Continue to property setup" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      const calls = trackEvent.mock.calls.filter(([event]) => event === "onboarding_completed");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({ onboarding_type: "manage_properties" });
    });

    it("does not fire onboarding_completed when organisation creation fails", async () => {
      const { OnboardingForm } = await import("@/components/onboarding-form");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { message: "Unable to create organisation." } }, false));
      const user = userEvent.setup();
      render(<OnboardingForm />);
      await user.type(screen.getByLabelText("Organisation name"), "Ama Properties");
      await user.click(screen.getByRole("button", { name: "Continue to property setup" }));
      await screen.findByText("Unable to create organisation.");
      expect(trackEvent).not.toHaveBeenCalledWith("onboarding_completed", expect.anything());
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("MarketplaceProfessionalOnboardingForm (onboarding_completed — market_properties)", () => {
    it("fires onboarding_completed exactly once on success", async () => {
      const { MarketplaceProfessionalOnboardingForm } = await import("@/components/marketplace-professional-onboarding-form");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: "pro-1" }));
      const user = userEvent.setup();
      render(<MarketplaceProfessionalOnboardingForm />);
      await user.type(screen.getByLabelText("Business / display name"), "Golden Coast Brokerage");
      await user.click(screen.getByRole("button", { name: "Create marketplace profile" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/pro/pro-1"));
      const calls = trackEvent.mock.calls.filter(([event]) => event === "onboarding_completed");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({ onboarding_type: "market_properties" });
    });

    it("does not fire onboarding_completed when profile creation fails", async () => {
      const { MarketplaceProfessionalOnboardingForm } = await import("@/components/marketplace-professional-onboarding-form");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: { message: "Unable to create your marketplace profile." } }, false));
      const user = userEvent.setup();
      render(<MarketplaceProfessionalOnboardingForm />);
      await user.type(screen.getByLabelText("Business / display name"), "Golden Coast Brokerage");
      await user.click(screen.getByRole("button", { name: "Create marketplace profile" }));
      await screen.findByText("Unable to create your marketplace profile.");
      expect(trackEvent).not.toHaveBeenCalledWith("onboarding_completed", expect.anything());
    });
  });

  describe("PublicListingDetail (property_view / property_enquiry)", () => {
    const listing = {
      id: "listing-1", listingType: "RENT", scope: "PROPERTY", category: "apartment",
      title: "Bright two-bedroom", description: "A lovely home.",
      pricing: { askingAmountMinor: null, rentAmountMinor: "250000", currencyCode: "GHS", frequency: "MONTHLY" },
      availability: { availableFrom: "2026-09-01", actual: true },
      attributes: { bedrooms: 2, bathrooms: "1.5", sizeSqm: "88.5" },
      location: { countryCode: "GH", region: "Greater Accra", city: "Accra", district: "Osu", locality: null, label: null, map: { latitude: null, longitude: null, precision: null, geocodingRequired: false } },
      amenities: [], media: [],
      contact: { name: null, email: "listings@example.com", phone: null, enquiryEnabled: true },
      verification: { status: "VERIFIED", evidenceReady: true },
      attribution: { listedBy: "Golden Coast Brokerage", professional: null },
      publishedAt: "2026-08-01T00:00:00.000Z",
    };

    it("fires property_view exactly once when the listing successfully loads, with safe categorical params only", async () => {
      const { PublicListingDetail } = await import("@/components/public-listing-detail");
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ listing }));
      render(<PublicListingDetail listingId="listing-1" />);
      await screen.findByText("Bright two-bedroom");
      const calls = trackEvent.mock.calls.filter(([event]) => event === "property_view");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({ property_type: "apartment", transaction_type: "RENT", region: "Greater Accra", city: "Accra" });
    });

    it("fires property_enquiry exactly once after a successful submission, with no PII in its params", async () => {
      const { PublicListingDetail } = await import("@/components/public-listing-detail");
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ listing }))
        .mockResolvedValueOnce(jsonResponse({ id: "lead-1" }));
      const user = userEvent.setup();
      render(<PublicListingDetail listingId="listing-1" />);
      await screen.findByText("Bright two-bedroom");
      await user.type(screen.getByLabelText("Your name"), "Kwame Enquirer");
      await user.type(screen.getByLabelText("Email"), "kwame@example.com");
      await user.click(screen.getByRole("button", { name: "Send request" }));
      await screen.findByText("Enquiry sent.");
      const calls = trackEvent.mock.calls.filter(([event]) => event === "property_enquiry");
      expect(calls).toHaveLength(1);
      const params = JSON.stringify(calls[0][1]);
      expect(params).not.toMatch(/Kwame|kwame@example\.com/);
      expect(calls[0][1]).toEqual({ property_type: "apartment", transaction_type: "RENT", region: "Greater Accra", city: "Accra", requested_viewing: false });
    });

    it("does not fire property_enquiry when the lead request fails", async () => {
      const { PublicListingDetail } = await import("@/components/public-listing-detail");
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ listing }))
        .mockResolvedValueOnce(jsonResponse({ error: { message: "Unable to send enquiry." } }, false));
      const user = userEvent.setup();
      render(<PublicListingDetail listingId="listing-1" />);
      await screen.findByText("Bright two-bedroom");
      await user.type(screen.getByLabelText("Your name"), "Kwame");
      await user.click(screen.getByRole("button", { name: "Send request" }));
      await screen.findByText("Unable to send enquiry.");
      expect(trackEvent).not.toHaveBeenCalledWith("property_enquiry", expect.anything());
    });

    it("does not double-fire property_enquiry on a rapid double submit", async () => {
      const { PublicListingDetail } = await import("@/components/public-listing-detail");
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ listing }))
        .mockResolvedValueOnce(jsonResponse({ id: "lead-1" }));
      const user = userEvent.setup();
      render(<PublicListingDetail listingId="listing-1" />);
      await screen.findByText("Bright two-bedroom");
      await user.type(screen.getByLabelText("Your name"), "Kwame");
      await user.dblClick(screen.getByRole("button", { name: "Send request" }));
      await screen.findByText("Enquiry sent.");
      const calls = trackEvent.mock.calls.filter(([event]) => event === "property_enquiry");
      expect(calls).toHaveLength(1);
      // 1 initial load fetch + 1 lead fetch — the double-click's second submit never went out.
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Existing marketing events continue functioning", () => {
    it("PageViewTracker fires its event exactly once on mount", async () => {
      const { PageViewTracker } = await import("@/components/marketing/page-view-tracker");
      render(<PageViewTracker event="ghana_landing_view" />);
      await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1));
      expect(trackEvent).toHaveBeenCalledWith("ghana_landing_view", undefined);
    });

    it("trackCampaignEvent (the pre-GA4 alias) still calls through to the same trackEvent", async () => {
      const { trackCampaignEvent } = await import("@/components/marketing/campaign-tracking");
      trackCampaignEvent("join_free_click", { placement: "ghana_hero" });
      expect(trackEvent).toHaveBeenCalledWith("join_free_click", { placement: "ghana_hero" });
    });
  });
});
