import type { MaintenancePriority, MaintenanceStatus, NewMaintenanceRequest, Tenancy, TenancyLease } from "@/api/tenant";

/** The server's `maintenanceCategorySchema` values (web repo `src/modules/maintenance/schemas.ts`). */
export const MAINTENANCE_CATEGORIES = [
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "roofing", label: "Roofing" },
  { value: "air conditioning", label: "Air conditioning" },
  { value: "appliance", label: "Appliance" },
  { value: "carpentry", label: "Carpentry" },
  { value: "painting", label: "Painting" },
  { value: "structural", label: "Structural" },
  { value: "security", label: "Security (locks, doors, windows)" },
  { value: "sanitation", label: "Sanitation" },
  { value: "other", label: "Something else" },
] as const;

export const MAINTENANCE_PRIORITIES: { value: MaintenancePriority; label: string; hint: string }[] = [
  { value: "EMERGENCY", label: "Emergency", hint: "Danger to people or property now (flooding, sparks, no way to lock up)" },
  { value: "URGENT", label: "Urgent", hint: "Needs attention within a day or two" },
  { value: "NORMAL", label: "Normal", hint: "Can be booked in the usual way" },
  { value: "LOW", label: "Low", hint: "Minor, whenever convenient" },
];

const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  REPORTED: "Reported",
  TRIAGED: "Being reviewed",
  AWAITING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  ASSIGNED: "Repair scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
};

export const statusLabel = (status: string) => STATUS_LABELS[status as MaintenanceStatus] ?? status;
export const categoryLabel = (category: string) => MAINTENANCE_CATEGORIES.find((item) => item.value === category)?.label ?? category;
export const priorityLabel = (priority: string) => MAINTENANCE_PRIORITIES.find((item) => item.value === priority)?.label ?? priority;
export const isOpenStatus = (status: string) => !["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(status);

export function leaseLabel(lease: Pick<TenancyLease, "property" | "unit">) {
  return lease.unit ? `${lease.property.name} · ${lease.unit.name}` : lease.property.name;
}

export type MaintenanceForm = { leaseId: string | null; category: string | null; priority: MaintenancePriority; title: string; description: string };
export type MaintenanceErrors = Partial<Record<"leaseId" | "category" | "title" | "description", string>>;

export const emptyMaintenanceForm = (tenancy: Tenancy | undefined): MaintenanceForm => ({
  // A single current lease is preselected; with several, the tenant picks the home.
  leaseId: tenancy?.leases.length === 1 ? tenancy.leases[0].id : null,
  category: null,
  priority: "NORMAL",
  title: "",
  description: "",
});

/** Same limits as the server's `createMaintenanceRequestSchema`; the server still validates. */
export function validateMaintenance(form: MaintenanceForm): MaintenanceErrors {
  const errors: MaintenanceErrors = {};
  if (!form.leaseId) errors.leaseId = "Choose which home this is for.";
  if (!form.category) errors.category = "Choose what kind of problem it is.";
  const title = form.title.trim();
  if (title.length < 3) errors.title = "Give the problem a short title (at least 3 characters).";
  else if (title.length > 200) errors.title = "Keep the title under 200 characters.";
  const description = form.description.trim();
  if (description.length < 3) errors.description = "Describe the problem (at least 3 characters).";
  else if (description.length > 10_000) errors.description = "Keep the description under 10,000 characters.";
  return errors;
}

export function toMaintenanceInput(tenancy: Tenancy, form: MaintenanceForm): NewMaintenanceRequest | null {
  const lease = tenancy.leases.find((item) => item.id === form.leaseId);
  if (!lease || !form.category) return null;
  return {
    propertyId: lease.property.id,
    unitId: lease.unit?.id,
    tenantOrganisationId: tenancy.tenantOrganisationId,
    title: form.title.trim(),
    description: form.description.trim(),
    category: form.category,
    priority: form.priority,
  };
}

export function formatDateTime(iso: string | null) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDay(iso: string | null) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
