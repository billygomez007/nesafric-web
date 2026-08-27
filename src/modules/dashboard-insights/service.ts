import { db } from "@/platform/database/client";
import { requirePermission, PERMISSIONS } from "@/platform/authorization/permissions";
import { resolveEntitlement } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";

export type DashboardOpportunity = { key: string; tone: "info" | "upgrade"; message: string; href: string };

/**
 * Lightweight contextual dashboard nudges (item 23) — deliberately NOT the `Campaign` banner
 * system: no advertising, no third party, nothing that "dominates operational UI". Every nudge is
 * derived from the organisation's own real state (vacant units, unconfigured entitled AI roles),
 * capped at a small count so this never becomes a feed.
 */
export async function getDashboardOpportunities(userId: string, organisationId: string): Promise<DashboardOpportunity[]> {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  const opportunities: DashboardOpportunity[] = [];

  const vacantUnits = await db.unit.count({ where: { property: { organisationId, archivedAt: null }, status: "AVAILABLE", archivedAt: null } });
  if (vacantUnits > 0) {
    opportunities.push({
      key: "vacant-units",
      tone: "info",
      message: `${vacantUnits} vacant unit${vacantUnits === 1 ? "" : "s"} ready to list.`,
      href: "/properties",
    });
  }

  const aiPropertyManagerEntitlement = await resolveEntitlement(organisationId, ENTITLEMENTS.aiPropertyManagerEnabled.key);
  if (aiPropertyManagerEntitlement.booleanValue) {
    const configured = await db.aIEmployee.count({ where: { organisationId, role: "PROPERTY_MANAGER" } });
    if (configured === 0) {
      opportunities.push({ key: "ai-property-manager", tone: "upgrade", message: "AI Property Manager is available on your plan but not yet configured.", href: "/ai/employees" });
    }
  }

  const aiReceptionistEntitlement = await resolveEntitlement(organisationId, ENTITLEMENTS.aiReceptionistTextEnabled.key);
  if (aiReceptionistEntitlement.booleanValue) {
    const configured = await db.aIEmployee.count({ where: { organisationId, role: "RECEPTIONIST" } });
    if (configured === 0) {
      opportunities.push({ key: "ai-receptionist", tone: "upgrade", message: "AI Receptionist is available on your plan but not yet configured.", href: "/ai/employees" });
    }
  }

  return opportunities.slice(0, 3);
}
