// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CompaniesCarouselTrack } from "@/components/marketing/companies-carousel-track";

const item = (slug: string) => ({ slug, displayName: slug.toUpperCase(), type: "BROKERAGE", logoUrl: null, verificationStatus: "VERIFIED" });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("homepage company rail track", () => {
  it("shows each company once when the strip is not wider than the screen", () => {
    render(<CompaniesCarouselTrack items={[item("canal-pc")]} />);
    expect(screen.getAllByRole("link", { hidden: true })).toHaveLength(1);
  });

  it("adds a hidden, unfocusable second copy only when the strip overflows", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    render(<CompaniesCarouselTrack items={[item("a"), item("b")]} />);
    await waitFor(() => expect(screen.getAllByRole("link", { hidden: true })).toHaveLength(4));
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
