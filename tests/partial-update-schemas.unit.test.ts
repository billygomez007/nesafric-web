import { describe, expect, it } from "vitest";
import { z } from "zod";
import { partialUpdateSchema } from "@/lib/partial-update-schema";
import { createLeaseSchema, updateLeaseSchema } from "@/modules/leases/schemas";
import { aiEmployeeUpdateSchema } from "@/modules/ai-employees/schemas";
import { marketplaceAIEmployeeUpdateSchema } from "@/modules/marketplace-ai/schemas";
import { updatePlanSchema } from "@/modules/subscriptions/schemas";
import { updateReminderPolicySchema } from "@/modules/reminders/schemas";

// zod 4 keeps `.default(...)` under `.partial()`, so an update schema built that way fills in
// omitted fields and the service overwrites stored values with the defaults.
describe("partial update schemas leave omitted fields undefined", () => {
  it("partialUpdateSchema strips defaults but keeps strictness", () => {
    const schema = partialUpdateSchema(z.object({ a: z.string().default("x"), b: z.boolean().optional().default(true), c: z.number() }).strict());
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ a: "y", b: false, c: 1 })).toEqual({ a: "y", b: false, c: 1 });
    expect(schema.safeParse({ d: 1 }).success).toBe(false);
  });

  it("lease update with only notes does not reset renewal or move status", () => {
    expect(updateLeaseSchema.parse({ notes: "x" })).toEqual({ notes: "x" });
    expect(updateLeaseSchema.parse({ moveStatus: "MOVED_IN" })).toEqual({ moveStatus: "MOVED_IN" });
  });

  it("lease create still applies defaults", () => {
    const created = createLeaseSchema.parse({
      referenceNumber: "LEASE-1", propertyId: "6f1c1a52-6a0b-4b43-9f1e-1c2d3e4f5a6b", tenantOrganisationIds: ["7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d"],
      startDate: "2026-01-01", rentAmountMinor: "1", currencyCode: "GHS", rentFrequency: "MONTHLY",
    });
    expect(created).toMatchObject({ status: "DRAFT", renewalStatus: "NOT_RENEWED", moveStatus: "NOT_MOVED_IN", documents: [] });
  });

  it("other update schemas do not inject defaults", () => {
    expect(aiEmployeeUpdateSchema.parse({ name: "Ama" })).toEqual({ name: "Ama" });
    expect(marketplaceAIEmployeeUpdateSchema.parse({ name: "Ama" })).toEqual({ name: "Ama" });
    expect(updatePlanSchema.parse({ name: "Pro" })).toEqual({ name: "Pro" });
    expect(updateReminderPolicySchema.parse({ daysOffset: 10 })).toEqual({ daysOffset: 10 });
  });

  it("reminder policy update with no fields is rejected", () => {
    expect(updateReminderPolicySchema.safeParse({}).success).toBe(false);
  });
});
