import type { ApiClient } from "./client";

/**
 * Tenant self-service shapes (web repo `src/modules/tenants/self-service.ts` and
 * `src/modules/maintenance/tenant-view.ts`). The maintenance view is the tenant-safe one: no staff
 * notes, costs, approvals, assignees or storage keys ever reach the app.
 */
export type TenancyLease = {
  id: string;
  status: "ACTIVE" | "EXPIRING";
  startDate: string;
  endDate: string | null;
  property: { id: string; name: string };
  unit: { id: string; name: string } | null;
};

export type Tenancy = {
  tenantOrganisationId: string;
  organisation: { id: string; name: string };
  leases: TenancyLease[];
};

export type MaintenanceStatus =
  | "REPORTED"
  | "TRIAGED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CLOSED"
  | "REJECTED"
  | "CANCELLED";

export type MaintenancePriority = "EMERGENCY" | "URGENT" | "NORMAL" | "LOW";

export type TenantMaintenanceRequest = {
  id: string;
  tenantOrganisationId: string | null;
  title: string;
  description: string;
  category: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  closedAt: string | null;
  property: { id: string; name: string };
  unit: { id: string; name: string } | null;
  attachments: { id: string; fileName: string; contentType: string | null; sizeBytes: number | null; createdAt: string }[];
  timeline: { id: string; fromStatus: MaintenanceStatus | null; toStatus: MaintenanceStatus; createdAt: string }[];
  workOrders: { id: string; title: string; status: string; dueAt: string | null; createdAt: string; assignedAt: string | null; startedAt: string | null; completedAt: string | null }[];
};

export type NewMaintenanceRequest = {
  propertyId: string;
  unitId?: string;
  tenantOrganisationId: string;
  title: string;
  description: string;
  category: string;
  priority: MaintenancePriority;
};

export const listTenancies = (api: ApiClient, signal?: AbortSignal) =>
  api.request<{ tenancies: Tenancy[] }>("/api/account/tenancies", { auth: true, signal });

export const listTenantMaintenance = (api: ApiClient, tenancy: Tenancy, signal?: AbortSignal) =>
  api.request<TenantMaintenanceRequest[]>(`/api/maintenance/tenants/${encodeURIComponent(tenancy.tenantOrganisationId)}/history`, {
    auth: true,
    organisationId: tenancy.organisation.id,
    signal,
  });

export const getTenantMaintenanceRequest = (api: ApiClient, tenancy: Tenancy, requestId: string, signal?: AbortSignal) =>
  api.request<TenantMaintenanceRequest>(`/api/maintenance/requests/${encodeURIComponent(requestId)}`, { auth: true, organisationId: tenancy.organisation.id, signal });

export const createTenantMaintenanceRequest = (api: ApiClient, tenancy: Tenancy, input: NewMaintenanceRequest) =>
  api.request<TenantMaintenanceRequest>("/api/maintenance/requests", { method: "POST", auth: true, organisationId: tenancy.organisation.id, body: input });
