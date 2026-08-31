// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendGAEvent = vi.fn();
vi.mock("@next/third-parties/google", () => ({ sendGAEvent }));

describe("analytics core (src/platform/analytics.ts)", () => {
  beforeEach(() => {
    sendGAEvent.mockClear();
    vi.resetModules();
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

  it("does not call sendGAEvent when NEXT_PUBLIC_GA_MEASUREMENT_ID is unset (dev/Preview safety)", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    const { trackEvent, isAnalyticsEnabled } = await import("@/platform/analytics");
    expect(isAnalyticsEnabled()).toBe(false);
    trackEvent("login");
    expect(sendGAEvent).not.toHaveBeenCalled();
  });

  it("calls sendGAEvent with the event name and params when a measurement ID is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST123");
    const { trackEvent, isAnalyticsEnabled } = await import("@/platform/analytics");
    expect(isAnalyticsEnabled()).toBe(true);
    trackEvent("sign_up", { method: "email" });
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "sign_up", { method: "email" });
  });
});
