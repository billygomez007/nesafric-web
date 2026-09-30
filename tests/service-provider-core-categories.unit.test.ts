import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const seed = fs.readFileSync(
  path.join(process.cwd(), "prisma/seed.ts"),
  "utf8",
);

const approvedParents = [
  "Construction & Building Works",
  "Repairs & Maintenance",
  "Cleaning & Property Care",
  "Landscaping & Outdoor Services",
  "Security, Access & Safety",
  "Energy, Power & Utilities",
  "Interior Design & Fit-Out",
  "Architecture, Engineering & Technical Services",
  "Surveying, Valuation & Planning",
  "Moving, Relocation & Storage",
  "Legal, Documentation & Compliance Services",
] as const;

const approvedLeaves = [
  ["general_contractor", "General Contractors"],
  ["building_contractor", "Building Contractors"],
  ["masonry", "Masonry & Blockwork"],
  ["carpentry", "Carpentry & Joinery"],
  ["roofing", "Roofing"],
  ["tiling", "Tiling"],
  ["painting", "Painting & Decorating"],
  ["welding", "Welding & Metal Fabrication"],
  ["glass_aluminium", "Glass & Aluminium Works"],
  ["steel_works", "Steel Works"],
  ["flooring_installation", "Flooring Installation"],
  ["scaffolding", "Scaffolding"],

  ["handyman", "General Handyman"],
  ["plumbing", "Plumbing Repairs"],
  ["electrical", "Electrical Repairs"],
  ["hvac", "Air Conditioning / HVAC"],
  ["appliance", "Appliance Repair"],
  ["septic_system_maintenance", "Septic System Maintenance"],
  ["elevator_lift_maintenance", "Elevator / Lift Maintenance"],

  ["residential_cleaning", "Residential Cleaning"],
  ["commercial_cleaning", "Commercial Cleaning"],
  ["deep_cleaning", "Deep Cleaning"],
  ["post_construction_cleaning", "Post-Construction Cleaning"],
  ["move_in_move_out_cleaning", "Move-In / Move-Out Cleaning"],
  ["carpet_upholstery_cleaning", "Carpet & Upholstery Cleaning"],
  ["pest_control", "Pest Control & Fumigation"],

  ["landscaping", "Landscaping"],
  ["gardening", "Gardening"],
  ["lawn_maintenance", "Lawn Maintenance"],
  ["tree_cutting_pruning", "Tree Cutting & Pruning"],
  ["fence_installation", "Fence Installation"],
  ["gate_installation", "Gate Installation"],
  ["paving_interlocking", "Paving & Interlocking"],
  ["outdoor_lighting", "Outdoor Lighting"],
  ["pool_construction", "Pool Construction"],

  ["security", "Security Guards"],
  ["cctv_installation", "CCTV Installation"],
  ["alarm_systems", "Alarm Systems"],
  ["access_control", "Access Control"],
  ["intercom_systems", "Intercom Systems"],
  ["electric_fencing", "Electric Fencing"],
  ["gate_automation", "Gate Automation"],
  ["fire_alarm_systems", "Fire Alarm Systems"],
  ["fire_extinguishers_suppression", "Fire Extinguishers & Suppression"],

  ["solar", "Solar Installation"],
  ["inverters_ups", "Inverters & UPS"],
  ["generator_power_backup", "Generator Installation & Maintenance"],
  ["borehole_water_systems", "Borehole Drilling"],
  ["water_pumps", "Water Pumps"],
  ["water_tanks", "Water Tanks"],
  ["water_treatment", "Water Treatment"],
  ["septic_sewage_systems", "Septic & Sewage Systems"],
  ["gas_lpg_systems", "Gas / LPG Systems"],
  ["ev_charging_installation", "EV Charging Installation"],

  ["interior_design", "Interior Design"],
  ["interior_fitout", "Interior Fit-Out"],
  ["furniture_joinery", "Furniture & Joinery"],
  ["custom_cabinetry", "Custom Cabinetry"],
  ["kitchen_installation", "Kitchen Installation"],
  ["bathroom_fitout", "Bathroom Fit-Out"],
  ["wardrobes_closets", "Wardrobes & Closets"],
  ["curtains_blinds", "Curtains & Blinds"],
  ["flooring", "Flooring"],
  ["wallpaper", "Wallpaper"],
  ["decorative_painting", "Decorative Painting"],
  ["lighting_design", "Lighting Design"],
  ["office_partitions", "Office Partitions"],

  ["architecture", "Architects"],
  ["building_designers", "Building Designers"],
  ["structural", "Structural Engineers"],
  ["civil_engineers", "Civil Engineers"],
  ["electrical_engineers", "Electrical Engineers"],
  ["mechanical_mep_engineers", "Mechanical / MEP Engineers"],
  ["geotechnical_engineers", "Geotechnical Engineers"],

  ["land_surveying", "Land Surveyors"],
  ["quantity_surveying", "Quantity Surveyors"],
  ["property_valuation", "Property Valuers / Estate Surveyors"],

  ["home_moving", "Home Moving"],
  ["office_moving", "Office Moving"],
  ["packing_services", "Packing Services"],
  ["furniture_moving", "Furniture Moving"],
  ["furniture_assembly", "Furniture Assembly"],
  ["relocation_services", "Relocation Services"],
  ["local_haulage", "Local Haulage"],
  ["property_clearance", "Property Clearance"],
  ["storage_services", "Storage Services"],
  ["warehouse_storage", "Warehouse Storage"],
  ["equipment_moving", "Equipment Moving"],

  ["property_lawyers", "Property Lawyers"],
  ["land_documentation", "Land Documentation"],
  ["building_permit_assistance", "Building Permit Assistance"],
  ["property_due_diligence", "Property Due Diligence"],
  ["land_registration_support", "Land Registration Support"],
] as const;

const hiddenLegacyKeys = [
  "locksmith",
  "facility_maintenance",
  "cleaning",
  "pool_maintenance",
  "sanitation",
  "water_tank_pump",
  "moving",
  "photography",
  "property_inspection",
  "other_property_service",
] as const;

describe("service provider category taxonomy", () => {
  it("contains exactly the approved eleven top-level Property Services categories", () => {
    const block = seed.match(
      /const propertyServiceGroups = \[([\s\S]*?)\] as const;/,
    );

    expect(block).not.toBeNull();

    const rows =
      block?.[1].match(
        /\["property_services_[^"]+",\s*"[^"]+",\s*\d+\]/g,
      ) ?? [];

    expect(rows).toHaveLength(11);

    for (const name of approvedParents) {
      expect(block?.[1]).toContain(`"${name}"`);
    }
  });

  it("contains every approved leaf service with its authoritative label", () => {
    for (const [key, name] of approvedLeaves) {
      expect(seed).toContain(`["${key}", "${name}",`);
    }
  });

  it("keeps compatible legacy keys where they represent approved leaf services", () => {
    expect(seed).toContain('["plumbing", "Plumbing Repairs",');
    expect(seed).toContain('["electrical", "Electrical Repairs",');
    expect(seed).toContain('["security", "Security Guards",');
    expect(seed).toContain('["solar", "Solar Installation",');
    expect(seed).toContain('["architecture", "Architects",');
    expect(seed).toContain('["structural", "Structural Engineers",');
    expect(seed).toContain('["land_surveying", "Land Surveyors",');
    expect(seed).toContain('["quantity_surveying", "Quantity Surveyors",');
    expect(seed).toContain(
      '["property_valuation", "Property Valuers / Estate Surveyors",',
    );
  });

  it("preserves ambiguous legacy rows but hides them from the new taxonomy", () => {
    expect(seed).toContain("hiddenLegacyCategoryKeys");

    for (const key of hiddenLegacyKeys) {
      expect(seed).toContain(`"${key}"`);
    }

    expect(seed).toContain("publiclyVisible: false");
    expect(seed).toContain("onboardingSelectable: false");
  });

  it("keeps electrical and security keys used by document requirements", () => {
    expect(seed).toContain('categoryKey: "electrical"');
    expect(seed).toContain('categoryKey: "security"');
  });
});
