import { describe, expect, it } from "vitest";
import type { AIProvider } from "@/modules/ai/providers";
import { classifyLocally, classifyReport, looksLikeMaintenance } from "@/modules/whatsapp-assistant/maintenance/classify";

const model = (args: Record<string, unknown>) => ({
  key: "test-model",
  complete: async () => ({ toolCall: { key: "classify_maintenance_report", arguments: args } }),
}) as unknown as AIProvider;

describe("maintenance report classification", () => {
  it("labels common reports with keyword rules", () => {
    expect(classifyLocally("The pipe under my kitchen sink is leaking")).toMatchObject({ category: "plumbing", priority: "URGENT", safetyHazard: false });
    expect(classifyLocally("Sparks and smoke coming from the bedroom socket")).toMatchObject({ category: "electrical", priority: "EMERGENCY", safetyHazard: true });
    expect(classifyLocally("The front door lock is broken, I can't lock it")).toMatchObject({ category: "security", priority: "URGENT" });
    expect(classifyLocally("Paint is peeling in the hallway")).toMatchObject({ category: "painting", priority: "LOW" });
    expect(classifyLocally("Something odd")).toMatchObject({ category: "other", priority: "NORMAL" });
  });

  it("uses the model's labels but never lowers urgency or clears a hazard found by the rules", async () => {
    const result = await classifyReport("Water is flooding the kitchen from a burst pipe", model({ category: "plumbing", priority: "LOW", safetyHazard: false, title: "Kitchen pipe burst" }));
    expect(result).toMatchObject({ category: "plumbing", priority: "EMERGENCY", safetyHazard: true, title: "Kitchen pipe burst", source: "model" });
  });

  it("falls back to the rules when the model answers outside the schema", async () => {
    const result = await classifyReport("The toilet is blocked", model({ category: "dispatch_to_kwame", priority: "NORMAL", safetyHazard: false, title: "x" }));
    expect(result).toMatchObject({ category: "plumbing", source: "rules" });
  });

  it("tells repair reports apart from marketplace searches", () => {
    expect(looksLikeMaintenance("my sink is leaking")).toBe(true);
    expect(looksLikeMaintenance("I need a plumber, the toilet is broken")).toBe(true);
    expect(looksLikeMaintenance("find an electrician in Osu")).toBe(false);
    expect(looksLikeMaintenance("2 bedroom flat in East Legon")).toBe(false);
  });
});
