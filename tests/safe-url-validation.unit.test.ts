import { describe, expect, it } from "vitest";
import { updateMarketplaceProfessionalSchema, createMarketplaceProfessionalSchema } from "@/modules/marketplace-professionals/schemas";
import { safeHttpUrl } from "@/platform/validation/url";
import { listingMediaSchema } from "@/modules/listings/schemas";

const DANGEROUS = ["javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd"];

describe("user-supplied URLs", () => {
  it("accept only absolute http(s) URLs", () => {
    const schema = safeHttpUrl(2000);
    expect(schema.safeParse("https://example.com/logo.png").success).toBe(true);
    expect(schema.safeParse("http://example.com").success).toBe(true);
    for (const value of [...DANGEROUS, "/relative/path", "example.com"]) expect(schema.safeParse(value).success).toBe(false);
  });

  it("are enforced on marketplace profile website and logo fields", () => {
    for (const value of DANGEROUS) {
      expect(updateMarketplaceProfessionalSchema.safeParse({ websiteUrl: value }).success).toBe(false);
      expect(createMarketplaceProfessionalSchema.safeParse({ type: "BROKERAGE", displayName: "X", countryCode: "GH", websiteUrl: value }).success).toBe(false);
      expect(createMarketplaceProfessionalSchema.safeParse({ type: "BROKERAGE", displayName: "X", countryCode: "GH", logoUrl: value }).success).toBe(false);
    }
  });

  it("are enforced on listing media rendered as public links", () => {
    for (const value of DANGEROUS) expect(listingMediaSchema.safeParse({ type: "VIDEO", publicUrl: value }).success).toBe(false);
    expect(listingMediaSchema.safeParse({ type: "VIDEO", publicUrl: "https://video.example.com/tour.mp4" }).success).toBe(true);
  });
});
