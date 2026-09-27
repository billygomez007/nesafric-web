import type { ApiClient } from "./client";

/**
 * Read-only workspace data for the mobile shells. Every call is authenticated and re-checked by the
 * server (membership, role permissions, provider ownership). Each response is copied into a narrow
 * shape holding only what the screens show, so contact details and internal fields the server may
 * return (tenant email and phone, evidence, notes) are never kept in the app.
 */

// Property management (`x-organisation-id`; the server checks membership and the permission).

export type PmProperty = { id: string; name: string; referenceNumber: string | null; category: string; status: string; city: string | null; units: number };
export type PmTenant = { id: string; name: string; since: string };
export type PmMaintenanceRequest = { id: string; title: string; priority: string; status: string; createdAt: string; place: string };
export type PmMaintenanceSummary = { total: number; open: number; openByPriority: Record<string, number> };

type RawProperty = { id: string; name: string; referenceNumber?: string | null; category: string; status: string; city?: string | null; _count?: { units?: number } };
type RawTenant = { id: string; createdAt: string; tenant: { legalName: string; preferredName?: string | null } };
type RawRequest = { id: string; title: string; priority: string; status: string; createdAt: string; property?: { name: string } | null; unit?: { name: string } | null };

export async function listPmProperties(api: ApiClient, organisationId: string, signal?: AbortSignal): Promise<PmProperty[]> {
  const rows = await api.request<RawProperty[]>("/api/properties", { auth: true, organisationId, signal });
  return rows.map((row) => ({ id: row.id, name: row.name, referenceNumber: row.referenceNumber ?? null, category: row.category, status: row.status, city: row.city ?? null, units: row._count?.units ?? 0 }));
}

export async function listPmTenants(api: ApiClient, organisationId: string, signal?: AbortSignal): Promise<PmTenant[]> {
  const rows = await api.request<RawTenant[]>("/api/tenants", { auth: true, organisationId, signal });
  return rows.map((row) => ({ id: row.id, name: row.tenant.preferredName || row.tenant.legalName, since: row.createdAt }));
}

export async function listPmMaintenance(api: ApiClient, organisationId: string, signal?: AbortSignal): Promise<PmMaintenanceRequest[]> {
  const rows = await api.request<RawRequest[]>("/api/maintenance/requests", { auth: true, organisationId, signal });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    createdAt: row.createdAt,
    place: [row.property?.name, row.unit?.name].filter(Boolean).join(" · "),
  }));
}

export async function getPmMaintenanceSummary(api: ApiClient, organisationId: string, signal?: AbortSignal): Promise<PmMaintenanceSummary> {
  const raw = await api.request<PmMaintenanceSummary>("/api/maintenance/dashboard", { auth: true, organisationId, signal });
  return { total: raw.total, open: raw.open, openByPriority: raw.openByPriority ?? {} };
}

// Real estate professional (`/api/marketplace-professionals/:id/…`; the server checks membership).

export type ProDashboard = {
  listings: { active: number; draft: number; pendingReview: number; paused: number; total: number };
  newLeads: number;
  upcomingViewings: number;
  teamMembers: number;
  profileCompletenessPercent: number;
  verificationStatus: string;
};
export type ProListing = {
  id: string;
  title: string;
  status: string;
  verificationStatus: string;
  listingType: "RENT" | "SALE";
  amountMinor: string | null;
  currencyCode: string;
  frequency: string | null;
};
export type ProListingPage = { items: ProListing[]; total: number };

type RawListing = ProListing & { askingAmountMinor?: string | null; rentAmountMinor?: string | null };

const proPath = (professionalId: string, path = "") => `/api/marketplace-professionals/${encodeURIComponent(professionalId)}${path}`;

export async function getProDashboard(api: ApiClient, professionalId: string, signal?: AbortSignal): Promise<ProDashboard> {
  const raw = await api.request<ProDashboard>(proPath(professionalId, "/dashboard"), { auth: true, signal });
  return {
    listings: raw.listings,
    newLeads: raw.newLeads,
    upcomingViewings: raw.upcomingViewings,
    teamMembers: raw.teamMembers,
    profileCompletenessPercent: raw.profileCompletenessPercent,
    verificationStatus: raw.verificationStatus,
  };
}

export async function listProListings(api: ApiClient, professionalId: string, signal?: AbortSignal): Promise<ProListingPage> {
  const raw = await api.request<{ items: RawListing[]; total: number }>(proPath(professionalId, "/listings"), { auth: true, query: { pageSize: 50 }, signal });
  return {
    total: raw.total,
    items: raw.items.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      verificationStatus: row.verificationStatus,
      listingType: row.listingType,
      amountMinor: (row.listingType === "SALE" ? row.askingAmountMinor : row.rentAmountMinor) ?? null,
      currencyCode: row.currencyCode,
      frequency: row.frequency ?? null,
    })),
  };
}

// Service provider (owner access to `/api/providers/:id…`; no organisation header is sent).

export type ProviderProfile = { displayName: string; verificationStatus: string; availabilityStatus: string; acceptingWork: boolean };
export type ProviderMetrics = { assignments: number; accepted: number; declined: number; completed: number; acceptanceRate: number | null; ratings: number; averageRating: number | null };
export type ProviderJob = { id: string; status: string; assignedAt: string; title: string; workOrderStatus: string; property: string | null };

type RawJob = { id: string; status: string; assignedAt: string; workOrder: { title: string; status: string; property?: { name: string } | null } };

const providerPath = (providerId: string, path = "") => `/api/providers/${encodeURIComponent(providerId)}${path}`;

export async function getProviderProfile(api: ApiClient, providerId: string, signal?: AbortSignal): Promise<ProviderProfile> {
  const raw = await api.request<{ provider: ProviderProfile }>(providerPath(providerId), { auth: true, signal });
  const { displayName, verificationStatus, availabilityStatus, acceptingWork } = raw.provider;
  return { displayName, verificationStatus, availabilityStatus, acceptingWork: Boolean(acceptingWork) };
}

export async function getProviderMetrics(api: ApiClient, providerId: string, signal?: AbortSignal): Promise<ProviderMetrics> {
  const raw = await api.request<ProviderMetrics>(providerPath(providerId, "/metrics"), { auth: true, signal });
  return {
    assignments: raw.assignments,
    accepted: raw.accepted,
    declined: raw.declined,
    completed: raw.completed,
    acceptanceRate: raw.acceptanceRate ?? null,
    ratings: raw.ratings,
    averageRating: raw.averageRating ?? null,
  };
}

export async function listProviderJobs(api: ApiClient, providerId: string, signal?: AbortSignal): Promise<ProviderJob[]> {
  const rows = await api.request<RawJob[]>(providerPath(providerId, "/jobs"), { auth: true, signal });
  return rows.map((row) => ({ id: row.id, status: row.status, assignedAt: row.assignedAt, title: row.workOrder.title, workOrderStatus: row.workOrder.status, property: row.workOrder.property?.name ?? null }));
}
