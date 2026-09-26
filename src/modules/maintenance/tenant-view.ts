import type { MaintenancePriority, MaintenanceStatus, WorkOrderStatus } from "@/platform/database/generated/client";

// Tenant-facing maintenance view. Tenants see their own request, its status timeline and
// work-order progress only. Staff notes, history metadata, actor ids, approvals, costs,
// payment/ledger references, assignees and storage keys are internal and never included.

type TenantViewSource = {
  id: string;
  tenantOrganisationId: string | null;
  title: string;
  description: string;
  category: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  closedAt: Date | null;
  property: { id: string; name: string };
  unit: { id: string; name: string } | null;
  attachments: { id: string; fileName: string; contentType: string | null; sizeBytes: number | null; createdAt: Date }[];
  history: { id: string; type: string; fromStatus: MaintenanceStatus | null; toStatus: MaintenanceStatus | null; createdAt: Date }[];
  workOrders: {
    id: string;
    title: string;
    status: WorkOrderStatus;
    dueAt: Date | null;
    createdAt: Date;
    assignedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }[];
};

export function toTenantMaintenanceView(request: TenantViewSource) {
  return {
    id: request.id,
    tenantOrganisationId: request.tenantOrganisationId,
    title: request.title,
    description: request.description,
    category: request.category,
    priority: request.priority,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
    closedAt: request.closedAt,
    property: { id: request.property.id, name: request.property.name },
    unit: request.unit ? { id: request.unit.id, name: request.unit.name } : null,
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
    })),
    timeline: request.history
      .filter((entry) => entry.type === "STATUS" && entry.toStatus)
      .map((entry) => ({ id: entry.id, fromStatus: entry.fromStatus, toStatus: entry.toStatus, createdAt: entry.createdAt })),
    workOrders: request.workOrders.map((workOrder) => ({
      id: workOrder.id,
      title: workOrder.title,
      status: workOrder.status,
      dueAt: workOrder.dueAt,
      createdAt: workOrder.createdAt,
      assignedAt: workOrder.assignedAt,
      startedAt: workOrder.startedAt,
      completedAt: workOrder.completedAt,
    })),
  };
}

export type TenantMaintenanceView = ReturnType<typeof toTenantMaintenanceView>;
