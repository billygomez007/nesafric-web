import { describe, expect, it } from "vitest";
import { campaignEligibility, creativeReadiness, hasPlacementArtwork, selectCampaignCreative } from "@/modules/campaigns/eligibility";
import { publicBannerListQuerySchema, updatePlatformCampaignSchema, createPlatformCampaignSchema } from "@/modules/campaigns/schemas";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const art = { desktopMediaUrl: "https://cdn.example.com/d.jpg", mobileMediaUrl: "https://cdn.example.com/m.jpg", nativeAppMediaUrl: null };
const base = { status: "APPROVED", placement: "MARKETPLACE_PRIMARY", startAt: null, endAt: null, archivedAt: null, countryCode: null, ...art };

describe("campaign eligibility (shared by the public carousels and Super Admin)", () => {
  it("a live platform-owned homepage campaign is eligible in APPROVED, SCHEDULED or ACTIVE", () => {
    for (const status of ["APPROVED", "SCHEDULED", "ACTIVE"]) expect(campaignEligibility({ ...base, status }, NOW)).toEqual({ eligible: true, reason: null });
  });

  it.each([
    ["DRAFT", "Draft — publish it to go live"],
    ["PENDING_APPROVAL", "Waiting for approval"],
    ["REJECTED", "Rejected"],
    ["PAUSED", "Paused"],
    ["COMPLETED", "Ended"],
    ["ARCHIVED", "Archived"],
  ])("%s is not eligible: %s", (status, reason) => {
    expect(campaignEligibility({ ...base, status }, NOW)).toEqual({ eligible: false, reason });
  });

  it("respects the campaign window", () => {
    expect(campaignEligibility({ ...base, status: "SCHEDULED", startAt: "2026-09-28T09:30:00.000Z" }, NOW)).toEqual({ eligible: false, reason: "Starts tomorrow at 09:30 UTC" });
    expect(campaignEligibility({ ...base, status: "SCHEDULED", startAt: "2026-09-27T15:00:00.000Z" }, NOW).reason).toBe("Starts today at 15:00 UTC");
    expect(campaignEligibility({ ...base, status: "SCHEDULED", startAt: "2026-10-05T08:00:00.000Z" }, NOW).reason).toBe("Starts 2026-10-05 at 08:00 UTC");
    expect(campaignEligibility({ ...base, status: "SCHEDULED", startAt: "2026-09-20T00:00:00.000Z", endAt: "2026-09-30T00:00:00.000Z" }, NOW).eligible).toBe(true);
    expect(campaignEligibility({ ...base, status: "ACTIVE", endAt: "2026-09-27T11:59:00.000Z" }, NOW)).toEqual({ eligible: false, reason: "Expired — its end date has passed" });
    expect(campaignEligibility({ ...base, archivedAt: NOW }, NOW).reason).toBe("Archived");
  });

  it("applies advertiser, country and placement rules", () => {
    expect(campaignEligibility({ ...base, countryCode: "NG" }, NOW)).toEqual({ eligible: false, reason: "Targeted at NG only" });
    expect(campaignEligibility({ ...base, countryCode: "GH" }, NOW).eligible).toBe(true);
    expect(campaignEligibility({ ...base, advertiserServiceProviderId: "p1", advertiserProvider: { verificationStatus: "PENDING" } }, NOW).reason).toBe("Advertised provider is not verified");
    expect(campaignEligibility({ ...base, advertiserServiceProviderId: "p1", advertiserProvider: { verificationStatus: "VERIFIED", suspendedAt: NOW } }, NOW).reason).toBe("Advertised provider is suspended");
    expect(campaignEligibility({ ...base, advertiserMarketplaceProfessionalId: "m1", advertiser: { status: "SUSPENDED", archivedAt: null } }, NOW).reason).toBe("Advertiser account is not active");
    expect(campaignEligibility({ ...base, advertiserMarketplaceProfessionalId: "m1", advertiser: { status: "ACTIVE", archivedAt: null } }, NOW).eligible).toBe(true);
    expect(campaignEligibility({ ...base, placement: "SEARCH_FEATURED" }, NOW)).toEqual({ eligible: false, reason: "This placement is not shown publicly yet" });
  });

  it("a live campaign without artwork its placement can show is not reported as showing", () => {
    const none = { desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: null };
    const reason = "No artwork uploaded — only the uploaded creative is shown";
    expect(campaignEligibility({ ...base, ...none }, NOW)).toEqual({ eligible: false, reason });
    expect(campaignEligibility({ ...base, ...none, desktopMediaUrl: " " }, NOW)).toEqual({ eligible: false, reason });
    // The homepage carousel also runs in the app, so app-only artwork is enough there…
    expect(campaignEligibility({ ...base, ...none, nativeAppMediaUrl: "https://cdn.example.com/n.jpg" }, NOW).eligible).toBe(true);
    // …but a web-only placement needs desktop or mobile web artwork.
    expect(campaignEligibility({ ...base, ...none, placement: "PROFESSIONAL_FEATURED", nativeAppMediaUrl: "https://cdn.example.com/n.jpg" }, NOW)).toEqual({ eligible: false, reason });
    expect(campaignEligibility({ ...base, ...none, placement: "MARKETPLACE_INLINE", mobileMediaUrl: "https://cdn.example.com/m.jpg" }, NOW).eligible).toBe(true);
    // The announcement bar is text by design and needs no artwork.
    expect(campaignEligibility({ ...base, ...none, placement: "HOMEPAGE_ANNOUNCEMENT" }, NOW)).toEqual({ eligible: true, reason: null });
    expect(hasPlacementArtwork({ ...none, placement: "HOMEPAGE_ANNOUNCEMENT" })).toBe(true);
  });
});

describe("campaign creative selection", () => {
  const all = { desktopMediaUrl: "d", mobileMediaUrl: "m", nativeAppMediaUrl: "n" };
  it("uses each surface's own creative", () => {
    expect(selectCampaignCreative(all, "desktopWeb")).toBe("d");
    expect(selectCampaignCreative(all, "mobileWeb")).toBe("m");
    expect(selectCampaignCreative(all, "nativeApp")).toBe("n");
  });
  it("falls back per the specification: desktop → mobile web; mobile web → desktop; app → mobile web → desktop", () => {
    expect(selectCampaignCreative({ desktopMediaUrl: "d", mobileMediaUrl: null, nativeAppMediaUrl: null }, "mobileWeb")).toBe("d");
    expect(selectCampaignCreative({ desktopMediaUrl: "d", mobileMediaUrl: "m", nativeAppMediaUrl: null }, "nativeApp")).toBe("m");
    expect(selectCampaignCreative({ desktopMediaUrl: "d", mobileMediaUrl: null }, "nativeApp")).toBe("d");
    // Desktop may borrow the mobile creative: it is shown whole at its own proportions, never cropped.
    expect(selectCampaignCreative({ desktopMediaUrl: null, mobileMediaUrl: "m", nativeAppMediaUrl: "n" }, "desktopWeb")).toBe("m");
    // App artwork is never used on the web.
    expect(selectCampaignCreative({ desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: "n" }, "desktopWeb")).toBeNull();
    expect(selectCampaignCreative({ desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: "n" }, "mobileWeb")).toBeNull();
  });
  it("reports readiness for Super Admin", () => {
    expect(creativeReadiness({ ...all, placement: "MARKETPLACE_PRIMARY" }).note).toBeNull();
    expect(creativeReadiness({ desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: null, placement: "MARKETPLACE_PRIMARY" }).note).toBe("No artwork: not shown anywhere until artwork is uploaded.");
    expect(creativeReadiness({ desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: "n", placement: "MARKETPLACE_PRIMARY" }).note).toBe("No artwork for desktop web or mobile web: not shown there.");
    expect(creativeReadiness({ desktopMediaUrl: null, mobileMediaUrl: null, nativeAppMediaUrl: "n", placement: "PROFESSIONAL_FEATURED" }).note).toBe("No artwork: not shown anywhere until artwork is uploaded.");
    expect(creativeReadiness({ desktopMediaUrl: "d", mobileMediaUrl: "m", nativeAppMediaUrl: null, placement: "MARKETPLACE_PRIMARY" }).note).toBe("No own app artwork: uses the next available creative.");
    expect(creativeReadiness({ desktopMediaUrl: null, mobileMediaUrl: null, placement: "HOMEPAGE_ANNOUNCEMENT" }).note).toBeNull();
  });
});

describe("campaign schemas", () => {
  it("lets Super Admin move a campaign to another placement, and rejects an end before the start", () => {
    expect(updatePlatformCampaignSchema.parse({ placement: "MARKETPLACE_PRIMARY" })).toEqual({ placement: "MARKETPLACE_PRIMARY" });
    expect(() => updatePlatformCampaignSchema.parse({ placement: "SIDEBAR" })).toThrow();
    const fields = { name: "n", headline: "h", destinationUrl: "https://example.com", placement: "MARKETPLACE_PRIMARY" };
    expect(createPlatformCampaignSchema.safeParse({ ...fields, startAt: "2026-10-02T00:00:00Z", endAt: "2026-10-01T00:00:00Z" }).success).toBe(false);
    expect(createPlatformCampaignSchema.safeParse({ ...fields, startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-02T00:00:00Z" }).success).toBe(true);
  });
  it("accepts the placement values the web and app carousels request", () => {
    for (const placement of ["MARKETPLACE_PRIMARY", "MARKETPLACE_INLINE"]) expect(publicBannerListQuerySchema.parse({ placement, countryCode: "gh", limit: "6" })).toEqual({ placement, countryCode: "GH", limit: 6 });
  });
});
