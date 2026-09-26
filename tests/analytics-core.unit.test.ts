// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("analytics core (src/platform/analytics.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("categorical trims, drops empty/whitespace-only values, and caps length", async () => {
    const { categorical } = await import("@/platform/analytics");
    expect(categorical(" Accra ")).toBe("Accra");
    expect(categorical("")).toBeUndefined();
    expect(categorical("   ")).toBeUndefined();
    expect(categorical(null)).toBeUndefined();
    expect(categorical(undefined)).toBeUndefined();
    expect(categorical("x".repeat(100), 10)).toBe("x".repeat(10));
  });

  it("compactParams drops only undefined entries, keeping falsy-but-real values", async () => {
    const { compactParams } = await import("@/platform/analytics");
    expect(compactParams({ a: "x", b: undefined, c: 0, d: false, e: "" })).toEqual({ a: "x", c: 0, d: false, e: "" });
  });

  it("does not push to dataLayer when NEXT_PUBLIC_GTM_ID is unset (dev/Preview safety)", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
    const { trackEvent, isAnalyticsEnabled } = await import("@/platform/analytics");
    expect(isAnalyticsEnabled()).toBe(false);
    trackEvent("login");
    expect((window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer).toBeUndefined();
  });

  it("pushes the event name and params to dataLayer when a GTM container is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST123");
    const { trackEvent, isAnalyticsEnabled } = await import("@/platform/analytics");
    expect(isAnalyticsEnabled()).toBe(true);
    trackEvent("sign_up", { method: "email" });
    expect((window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer).toEqual([
      { event: "sign_up", method: "email" },
    ]);
  });
});
