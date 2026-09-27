// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/marketing/campaign-tracking", () => ({ trackCampaignEvent: vi.fn() }));
vi.mock("@/components/onboarding-form", () => ({ OnboardingForm: () => <p>organisation form</p> }));
vi.mock("@/components/marketplace-professional-onboarding-form", () => ({ MarketplaceProfessionalOnboardingForm: () => <p>professional form</p> }));
vi.mock("@/components/service-provider-onboarding-form", () => ({ ServiceProviderOnboardingForm: () => <p>provider form</p> }));

const { default: OnboardingPage } = await import("@/app/onboarding/page");

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/onboarding"); });

describe("onboarding ?start=", () => {
  it.each([["manage", "organisation form"], ["market", "professional form"], ["services", "provider form"]])("start=%s opens that setup directly", async (start, form) => {
    window.history.replaceState(null, "", `/onboarding?start=${start}`);
    render(<OnboardingPage />);
    expect(await screen.findByText(form)).toBeTruthy();
  });

  it("shows the chooser without, or with an unknown, start value", () => {
    window.history.replaceState(null, "", "/onboarding?start=admin");
    render(<OnboardingPage />);
    expect(screen.getByText("Choose your starting workspace")).toBeTruthy();
  });
});
