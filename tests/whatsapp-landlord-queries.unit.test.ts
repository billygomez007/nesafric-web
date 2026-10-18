import { describe, expect, it } from "vitest";
import { classifyLandlordQueryLocally } from "@/modules/whatsapp-assistant/landlord";

describe("landlord question classification", () => {
  it.each([
    ["How many units do I manage?", "unit_count"],
    ["Which units have open maintenance requests?", "open_requests"],
    ["What work was completed today?", "completed_today"],
    ["Which repairs need my approval?", "approvals"],
    ["Show upcoming lease expirations.", "lease_expiries"],
    ["Add another electrician.", "add_provider"],
    ["Set a quote approval limit for this building.", "approval_limit_help"],
    ["Show today's maintenance costs", "costs_today"],
    ["Show ticket NM-1042", "show_ticket"],
    ["alerts", "alerts"],
    ["2 bedroom flat in Osu", "none"],
  ])("%s → %s", (text, intent) => {
    expect(classifyLandlordQueryLocally(text).intent).toBe(intent);
  });

  it("extracts the ticket reference", () => {
    expect(classifyLandlordQueryLocally("show ticket nm-1042")).toEqual({ intent: "show_ticket", reference: "NM-1042" });
  });
});
