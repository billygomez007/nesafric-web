// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The professional has one "Submit for review" action (no browser prompt): it asks for authority
 * evidence only when NesAfric doesn't have it. Reviewers get "Verify & publish" only when the
 * listing can actually go live.
 */

const PRO = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING, title: "Three-bedroom house, East Legon", status: "DRAFT", verificationStatus: "UNVERIFIED", listingType: "RENT",
    city: "Accra", locality: "East Legon", marketplaceAssetId: "a", listingRepresentativeUserId: null, listingAuthority: "OWNER_SELF",
    category: "HOUSE", publicDescription: "A bright family home.", rentAmountMinor: "950000", currencyCode: "GHS", frequency: "MONTHLY",
    media: [{ id: "m1", type: "PHOTO", publicUrl: "https://images.nesafric.com/x.jpg", isCover: true, altText: null }],
    statusHistory: [], verificationEvidence: [],
    ...overrides,
  };
}

function mockApi(item: ReturnType<typeof listing>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
    const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    if (url.includes("/submit")) return json({ ...item, status: "PENDING_REVIEW" });
    return json({ items: [item], total: 1, page: 1, pageSize: 25 });
  }));
  return calls;
}

const { MarketplaceListingsDashboard } = await import("@/components/marketplace-listings-dashboard");
const { ListingReviewQueue } = await import("@/components/platform-admin/listing-review-queue");

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("professional Submit for review", () => {
  it("asks for authority evidence in a dialog (never window.prompt) and submits listing + evidence together", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const calls = mockApi(listing());
    render(<MarketplaceListingsDashboard professionalId={PRO} />);
    fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));

    const dialog = await screen.findByRole("dialog", { name: "Submit for review" });
    expect(screen.queryByRole("button", { name: /submit verification/i })).toBeNull();
    const send = within(dialog).getByRole("button", { name: "Submit for review" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Authority evidence"), { target: { value: "developer_authority" } });
    fireEvent.change(within(dialog).getByLabelText(/Reference/), { target: { value: "Developer letter ref DA-2026-07" } });
    fireEvent.click(send);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: `/api/marketplace-professionals/${PRO}/listings/${LISTING}/submit`, body: { evidence: { type: "developer_authority", reference: "Developer letter ref DA-2026-07" } } });
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("goes straight to review when verification is already pending", async () => {
    const calls = mockApi(listing({ verificationStatus: "PENDING", verificationEvidence: [{ id: "e1" }] }));
    render(<MarketplaceListingsDashboard professionalId={PRO} />);
    fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells the professional what is missing instead of submitting a listing without a photo", async () => {
    const calls = mockApi(listing({ media: [] }));
    render(<MarketplaceListingsDashboard professionalId={PRO} />);
    fireEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText(/Add at least one photo/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows NesAfric's note when a listing was returned for changes", async () => {
    mockApi(listing({ verificationStatus: "PENDING", statusHistory: [{ fromStatus: "PENDING_REVIEW", toStatus: "DRAFT", note: "Add the plot size.", createdAt: "2026-09-25T10:00:00Z" }] }));
    render(<MarketplaceListingsDashboard professionalId={PRO} />);
    expect(await screen.findByText("NesAfric asked for changes")).toBeTruthy();
    expect(screen.getByText("Add the plot size.")).toBeTruthy();
  });
});

function reviewListing(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING, title: "Three-bedroom house, East Legon", listingType: "RENT", category: "HOUSE", status: "PENDING_REVIEW", verificationStatus: "PENDING",
    submittedAt: null, updatedAt: "2026-09-25T10:00:00.000Z", askingAmountMinor: null, rentAmountMinor: "950000", currencyCode: "GHS", frequency: "MONTHLY",
    city: "Accra", district: null, locality: "East Legon", region: null, publicLocationLabel: null, countryCode: "GH", listingAuthority: "OWNER_SELF",
    organisation: { id: "o", name: "Backing org" }, marketplaceProfessional: { id: PRO, displayName: "Review Brokerage", slug: "r", verificationStatus: "UNVERIFIED" },
    cover: { publicUrl: "https://images.nesafric.com/x.jpg", altText: null }, photoCount: 1, readinessProblems: [],
    evidence: [{ id: "e1", type: "owner_mandate", privateReference: "Mandate ref 12", createdAt: "2026-09-25T09:00:00Z", expiresAt: null }],
    _count: { verificationEvidence: 1, media: 1 },
    ...overrides,
  };
}

describe("platform listing review", () => {
  it("confirms before Verify & publish and sends the reviewed version", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return { ok: true, json: async () => ({}) } as Response;
    }));
    const onDecided = vi.fn();
    render(<ListingReviewQueue canDecide listings={[reviewListing()]} onDecided={onDecided} />);
    expect(screen.getByText(/Mandate ref 12/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Verify & publish" }));
    const dialog = screen.getByRole("dialog", { name: "Verify & publish?" });
    expect(within(dialog).getByText(/public on the NesAfric marketplace/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Verify & publish now" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(LISTING));
    expect(posts).toEqual([{ url: `/api/platform-admin/listings/${LISTING}/publish`, body: { expectedUpdatedAt: "2026-09-25T10:00:00.000Z" } }]);
  });

  it("never offers publication for an unverified or incomplete listing, and requires a note to return it", () => {
    render(<ListingReviewQueue canDecide listings={[
      reviewListing({ id: "a", title: "Unverified", verificationStatus: "UNVERIFIED", evidence: [] }),
      reviewListing({ id: "b", title: "No photo", photoCount: 0, cover: null, readinessProblems: [{ field: "media", message: "Add at least one photo." }] }),
    ]} onDecided={() => {}} />);
    const buttons = screen.getAllByRole("button", { name: "Verify & publish" }) as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(screen.getByText(/Verification not submitted/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Request changes" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Request changes" });
    const send = within(dialog).getByRole("button", { name: "Return for changes" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/What needs to change/), { target: { value: "Add the mandate reference." } });
    expect(send.disabled).toBe(false);
  });

  it("labels an already-verified listing in review as Publish and hides decisions from view-only roles", () => {
    const { unmount } = render(<ListingReviewQueue canDecide listings={[reviewListing({ verificationStatus: "VERIFIED" })]} onDecided={() => {}} />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    unmount();
    render(<ListingReviewQueue canDecide={false} listings={[reviewListing()]} onDecided={() => {}} />);
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
    expect(screen.getByText(/View only/)).toBeTruthy();
  });
});
