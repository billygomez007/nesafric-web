import type { z } from "zod";
import type { maintenanceCategorySchema } from "@/modules/maintenance/schemas";

type MaintenanceCategory = z.infer<typeof maintenanceCategorySchema>;

/**
 * Normalizes a `MaintenanceRequest.category` value to the `ServiceCategory.key` it should match
 * for provider eligibility. These are two independently-evolving lists — the maintenance intake
 * enum (fixed at Zod-schema level, rarely changed) and the admin-managed service-category
 * taxonomy (seeded, editable via Platform Admin) — kept in sync by hand here rather than assuming
 * the strings always coincide. Most values already match identically; only the two that don't
 * ("air conditioning" -> "hvac", "other" -> "other_property_service") actually need this map, but
 * every value is listed explicitly so a future maintenance-category addition without a
 * corresponding entry here fails loudly (via the exhaustive switch) instead of silently matching
 * zero providers.
 */
export function normalizeMaintenanceCategoryToServiceCategoryKey(category: MaintenanceCategory): string {
  switch (category) {
    case "plumbing": return "plumbing";
    case "electrical": return "electrical";
    case "roofing": return "roofing";
    case "air conditioning": return "hvac";
    case "appliance": return "appliance";
    case "carpentry": return "carpentry";
    case "painting": return "painting";
    case "structural": return "structural";
    case "security": return "security";
    case "sanitation": return "sanitation";
    case "other": return "other_property_service";
    default: {
      const exhaustive: never = category;
      throw new Error(`No ServiceCategory mapping defined for maintenance category '${exhaustive}'.`);
    }
  }
}
