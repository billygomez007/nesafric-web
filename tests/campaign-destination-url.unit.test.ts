import { describe, expect, it } from "vitest";
import { createPlatformCampaignSchema, createSelfServiceCampaignSchema } from "@/modules/campaigns/schemas";

const base = { name: "Test campaign", headline: "Headline", destinationUrl: "https://example.com/ok" };

describe("campaign destination/media URL safety", () => {
  it.each([
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "not a url at all",
    "",
  ])("rejects an unsafe or invalid destinationUrl: %s", (destinationUrl) => {
    const result = createPlatformCampaignSchema.safeParse({ ...base, placement: "MARKETPLACE_PRIMARY", destinationUrl });
    expect(result.success).toBe(false);
  });

  it.each(["https://umoafric.com/marketplace/properties/abc", "http://staging.umoafric.com/x"])(
    "accepts a safe absolute http(s) destinationUrl: %s",
    (destinationUrl) => {
      const result = createPlatformCampaignSchema.safeParse({ ...base, placement: "MARKETPLACE_PRIMARY", destinationUrl });
      expect(result.success).toBe(true);
    },
  );

  it("rejects a javascript: desktopMediaUrl on a self-service submission", () => {
    const result = createSelfServiceCampaignSchema.safeParse({
      ...base, placement: "MARKETPLACE_INLINE", desktopMediaUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });
});
