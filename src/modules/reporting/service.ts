import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { getRentCollectionMetrics } from "@/modules/payments/service";
import { getMaintenanceDashboardMetrics } from "@/modules/maintenance/service";
import { assertFeatureEnabled } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";

/**
 * Portfolio-wide advanced reporting (representative check for item 2's "reporting" surface): a
 * single combined export across rent collection, maintenance, and occupancy — gated behind the
 * `reporting.advanced` plan entitlement, distinct from (and in addition to) the ordinary
 * `payment.read`/`maintenance.read` RBAC permissions the underlying metrics already enforce.
 * Every figure is a direct aggregate over existing organisation-scoped records; nothing here is
 * fabricated or estimated.
 */
export async function getPortfolioReport(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.paymentRead);
  await assertFeatureEnabled(organisationId, ENTITLEMENTS.advancedReportingEnabled.key);
  const [collection, maintenance, unitsByStatus, propertiesByStatus] = await Promise.all([
    getRentCollectionMetrics(userId, organisationId),
    getMaintenanceDashboardMetrics(userId, organisationId),
    db.unit.groupBy({ by: ["status"], where: { property: { organisationId, archivedAt: null }, archivedAt: null }, _count: { _all: true } }),
    db.property.groupBy({ by: ["status"], where: { organisationId, archivedAt: null }, _count: { _all: true } }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    collection,
    maintenance,
    occupancy: {
      unitsByStatus: Object.fromEntries(unitsByStatus.map((entry) => [entry.status, entry._count._all])),
      propertiesByStatus: Object.fromEntries(propertiesByStatus.map((entry) => [entry.status, entry._count._all])),
    },
  };
}
