import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const seed = fs.readFileSync(
  path.join(process.cwd(), "prisma", "seed.ts"),
  "utf8",
);

const requiredCategories = [
  ["plumbing", "Plumbing"],
  ["electrical", "Electrical"],
  ["cleaning", "Cleaning Services"],
  ["hvac", "Air conditioning / HVAC"],
  ["carpentry", "Carpentry & Joinery"],
  ["painting", "Painting & Decorating"],
  ["building_contractor", "Masons & Building Contractors"],
  ["security", "Security Services"],
  ["landscaping", "Landscaping & Gardening"],
  ["pest_control", "Pest Control & Fumigation"],
  ["land_surveying", "Land Surveyors"],
  ["property_valuation", "Property Valuers / Estate Surveyors"],
  ["quantity_surveying", "Quantity Surveyors"],
  ["architecture", "Architects & Building Designers"],
  ["facility_maintenance", "Facilities & Property Maintenance"],
] as const;

describe("NesAfric core service-provider categories", () => {
  it("contains all 15 core marketplace categories in the canonical seed", () => {
    for (const [key, name] of requiredCategories) {
      expect(seed).toContain(`["${key}", "${name}"`);
    }
  });

  it("keeps category creation idempotent", () => {
    expect(seed).toContain("prisma.serviceCategory.upsert");
  });
});
