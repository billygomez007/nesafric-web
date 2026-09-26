import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Routes read the session from next/headers: a controllable request so each call can be made as
// a given mobile bearer session.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => request.headers,
}));

import { GET as crmDashboard } from "@/app/api/crm/dashboard/route";
import { GET as orgLeadDetail, PATCH as orgLeadPatch } from "@/app/api/marketplace-leads/[leadId]/route";
import { GET as orgLeads } from "@/app/api/marketplace-leads/route";
import { GET as proLeadDetail } from "@/app/api/marketplace-professionals/[professionalId]/leads/[leadId]/route";
import { GET as proLeads } from "@/app/api/marketplace-professionals/[professionalId]/leads/route";
import { GET as proViewingDetail } from "@/app/api/marketplace-professionals/[professionalId]/viewings/[viewingRequestId]/route";
import { GET as proViewings } from "@/app/api/marketplace-professionals/[professionalId]/viewings/route";
import { GET as orgViewingDetail } from "@/app/api/viewing-requests/[viewingRequestId]/route";
import { GET as orgViewings } from "@/app/api/viewing-requests/route";
import { GET as workspaces } from "@/app/api/workspaces/route";
import { createProperty } from "@/modules/assets/service";
import { registerUser } from "@/modules/identity/service";
import {
  createListing, createMarketplaceLead, createMarketplaceNativeListing, createViewingRequest, submitMarketplaceProfessionalListingVerification,
  transitionListing, transitionMarketplaceProfessionalListing, updateListingVerification, updateMarketplaceLead, updateMarketplaceProfessionalLead,
} from "@/modules/listings/service";
import { addMarketplaceMember, assignMarketplaceLead, createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createSessionRecord } from "@/platform/auth/session";
import { db } from "@/platform/database/client";

const PASSWORD = "secure-password-123";
const FORBIDDEN_KEYS = ["idempotencyKeyHash", "idempotencyFingerprint", "passwordHash", "organisationId", "userId", "actorUserId", "tokenHash", "metadata", "tenantOrganisationId", "applicantId", "leaseId"];

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "PublicWriteCounter", "PublicIdempotencyRecord" CASCADE');
}

async function bearerFor(userId: string) {
  return (await createSessionRecord(userId)).token;
}

function as(token: string | null, organisationId?: string) {
  request.headers = new Headers();
  if (token) request.headers.set("authorization", `Bearer ${token}`);
  if (organisationId) request.headers.set("x-organisation-id", organisationId);
}

const url = (path: string) => new Request(`https://nesafric.test${path}`, { headers: request.headers });
const nextUrl = (path: string) => Object.assign(url(path), { nextUrl: new URL(`https://nesafric.test${path}`) }) as never;
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

/** Every key anywhere in a JSON body. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysIn(item, found));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { found.add(key); keysIn(child, found); }
  return found;
}
function expectNoInternalFields(body: unknown) {
  const keys = keysIn(body);
  for (const key of FORBIDDEN_KEYS) expect(keys.has(key), `response must not contain "${key}"`).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/\$argon2/);
}

const nativeInput = (title: string) => ({
  asset: { name: title, category: "apartment", purpose: "RENT", bedrooms: 2, currencyCode: "GHS", priceMinor: "450000", countryCode: "GH", city: "Accra", mediaUrls: ["https://cdn.example.com/a.jpg"], availableFrom: "2026-09-01", authorityEvidenceReady: true },
  listing: { listingType: "RENT", category: "apartment", title, publicDescription: "Professionally marketed apartment for the agent inbox test.", rentAmountMinor: "450000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", city: "Accra", media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/a.jpg" }], amenities: [] },
  listingAuthority: "BROKERAGE_AUTHORIZED",
});

async function publishedNativeListing(ownerId: string, professional: { id: string; backingOrganisationId: string }, title: string) {
  const listing = await createMarketplaceNativeListing(ownerId, professional.id, nativeInput(title));
  await submitMarketplaceProfessionalListingVerification(ownerId, professional.id, listing.id, { status: "PENDING", evidence: [{ type: "marketing_authority", privateReference: "private/authority.pdf" }] });
  await updateListingVerification(ownerId, professional.backingOrganisationId, listing.id, { status: "VERIFIED" });
  await transitionMarketplaceProfessionalListing(ownerId, professional.id, listing.id, { status: "PENDING_REVIEW" });
  await transitionMarketplaceProfessionalListing(ownerId, professional.id, listing.id, { status: "PUBLISHED" });
  return listing;
}

const soon = () => { const start = new Date(Date.now() + 5 * 86_400_000); return [{ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(), timezone: "Africa/Accra" }]; };

let fx: Awaited<ReturnType<typeof setup>>;

async function setup() {
  // Agency X: owner + agent; agency Y: a different agent business; landlord L: a PropertyOS organisation.
  const xOwner = await registerUser({ displayName: "Xena Owner", email: "x-owner@agent-inbox.test", password: PASSWORD });
  const xAgent = await registerUser({ displayName: "Kwesi Agent", email: "x-agent@agent-inbox.test", password: PASSWORD });
  const xRemoved = await registerUser({ displayName: "Removed Agent", email: "x-removed@agent-inbox.test", password: PASSWORD });
  const xSuspended = await registerUser({ displayName: "Suspended Agent", email: "x-suspended@agent-inbox.test", password: PASSWORD });
  const yOwner = await registerUser({ displayName: "Yaa Owner", email: "y-owner@agent-inbox.test", password: PASSWORD });
  const landlord = await registerUser({ displayName: "Lamptey Landlord", email: "landlord@agent-inbox.test", password: PASSWORD });
  const stranger = await registerUser({ displayName: "Stranger", email: "stranger@agent-inbox.test", password: PASSWORD });

  const x = await createMarketplaceProfessional(xOwner.id, { type: "BROKERAGE", displayName: "Xcel Realty", countryCode: "GH" });
  const y = await createMarketplaceProfessional(yOwner.id, { type: "BROKERAGE", displayName: "Yield Homes", countryCode: "GH" });
  const xAgentMember = await addMarketplaceMember(xOwner.id, x.id, { email: xAgent.email, role: "AGENT" });
  const removed = await addMarketplaceMember(xOwner.id, x.id, { email: xRemoved.email, role: "AGENT" });
  await db.marketplaceProfessionalMember.update({ where: { id: removed.id }, data: { status: "REMOVED" } });
  // Written directly: the free plan's 3-seat limit would otherwise refuse a fourth member.
  await db.marketplaceProfessionalMember.create({ data: { marketplaceProfessionalId: x.id, userId: xSuspended.id, role: "AGENT", status: "SUSPENDED" } });

  const xListing = await publishedNativeListing(xOwner.id, x, "Xcel apartment, Cantonments");
  const yListing = await publishedNativeListing(yOwner.id, y, "Yield apartment, Spintex");

  // Landlord's own PropertyOS listing, marketed by agency X (third-party attribution): its leads
  // belong to the landlord's organisation, yet agency X's team must see them.
  const org = await createOrganisation(landlord.id, { name: "Lamptey Estates", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
  const property = await createProperty(landlord.id, org.id, { name: "Lamptey House", referenceNumber: "LH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
  const lListing = await createListing(landlord.id, org.id, {
    propertyId: property.id, listingType: "RENT", category: "apartment", title: "Lamptey House flat", publicDescription: "Landlord flat marketed by an agency.",
    rentAmountMinor: "300000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", enquiryEnabled: true,
    media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/l.jpg", mimeType: "image/jpeg", sortOrder: 1 }],
  });
  await updateListingVerification(landlord.id, org.id, lListing.id, { status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/deed.pdf", metadata: {} }] });
  await updateListingVerification(landlord.id, org.id, lListing.id, { status: "VERIFIED", note: "Checked." });
  await transitionListing(landlord.id, org.id, lListing.id, { status: "PENDING_REVIEW" });
  await transitionListing(landlord.id, org.id, lListing.id, { status: "PUBLISHED" });
  await db.listing.update({ where: { id: lListing.id }, data: { marketplaceProfessionalId: x.id } });

  const submission = { keyHash: "a".repeat(64), fingerprint: "b".repeat(64) };
  const xLead = await createMarketplaceLead(xListing.id, undefined, { name: "Adjoa Prospect", phone: "+233 24 111 2222", email: "adjoa@example.com", message: "Available in October?" }, { submission });
  const lLead = await createMarketplaceLead(lListing.id, undefined, { name: "Third Party Prospect", phone: "0244000111" });
  const yLead = await createMarketplaceLead(yListing.id, undefined, { name: "Yield Prospect", email: "yield@example.com" });
  const xViewing = await createViewingRequest(xListing.id, undefined, { leadId: xLead.id, preferredTimes: soon(), requesterNote: "Mornings please" });
  const lViewing = await createViewingRequest(lListing.id, undefined, { leadId: lLead.id, preferredTimes: soon() });
  const yViewing = await createViewingRequest(yListing.id, undefined, { leadId: yLead.id, preferredTimes: soon() });

  await updateMarketplaceProfessionalLead(xOwner.id, x.id, xLead.id, { privateNotes: "Staff only: budget is tight." });
  await assignMarketplaceLead(xOwner.id, x.id, xLead.id, xAgentMember.id);
  const landlordMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: org.id, userId: landlord.id } });
  await updateMarketplaceLead(landlord.id, org.id, lLead.id, { assigneeMemberId: landlordMember.id });

  return {
    x, y, org, xLead, lLead, yLead, xViewing, lViewing, yViewing,
    tokens: {
      xOwner: await bearerFor(xOwner.id), xAgent: await bearerFor(xAgent.id), xRemoved: await bearerFor(xRemoved.id),
      xSuspended: await bearerFor(xSuspended.id), yOwner: await bearerFor(yOwner.id), landlord: await bearerFor(landlord.id), stranger: await bearerFor(stranger.id),
    },
  };
}

describe("agent inbox access and response shapes", () => {
  beforeAll(async () => {
    await cleanDatabase();
    fx = await setup();
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("lists an agent's own professional workspace only, never its backing organisation", async () => {
    as(fx.tokens.xAgent);
    const body = await (await workspaces()).json();
    expect(body.propertyOsOrganisations).toEqual([]);
    expect(body.marketplaceProfessionals.map((item: { id: string }) => item.id)).toEqual([fx.x.id]);
    expect(body.marketplaceProfessionals[0]).toMatchObject({ myRole: "AGENT", status: "ACTIVE" });
    expectNoInternalFields(body);
    expect(keysIn(body).has("backingOrganisationId")).toBe(false);

    for (const token of [fx.tokens.xRemoved, fx.tokens.xSuspended, fx.tokens.stranger]) {
      as(token);
      expect((await (await workspaces()).json()).marketplaceProfessionals).toEqual([]);
    }
  });

  it("gives every active member the professional's enquiries, including third-party listings, and nothing else", async () => {
    as(fx.tokens.xAgent);
    const response = await proLeads(nextUrl(`/api/marketplace-professionals/${fx.x.id}/leads?view=inbox`), ctx({ professionalId: fx.x.id }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((lead: { id: string }) => lead.id).sort()).toEqual([fx.xLead.id, fx.lLead.id].sort());
    expect(body.pagination).toMatchObject({ total: 2 });
    // Inbox list rows: no contact details, notes or internal ids.
    expect(Object.keys(body.items[0]).sort()).toEqual(["createdAt", "id", "lastActivityAt", "listing", "name", "status"]);
    expectNoInternalFields(body);

    const viewings = await (await proViewings(nextUrl(`/api/marketplace-professionals/${fx.x.id}/viewings`), ctx({ professionalId: fx.x.id }))).json();
    expect(viewings.items.map((item: { id: string }) => item.id).sort()).toEqual([fx.xViewing.id, fx.lViewing.id].sort());
    expectNoInternalFields(viewings);
  });

  it("refuses another agency's enquiries however the URL or organisation header is changed", async () => {
    as(fx.tokens.xAgent);
    // Another professional's inbox.
    expect((await proLeads(nextUrl(`/api/marketplace-professionals/${fx.y.id}/leads`), ctx({ professionalId: fx.y.id }))).status).toBe(403);
    expect((await proLeadDetail(url(`/api/marketplace-professionals/${fx.y.id}/leads/${fx.yLead.id}`), ctx({ professionalId: fx.y.id, leadId: fx.yLead.id }))).status).toBe(403);
    expect((await proViewings(nextUrl(`/api/marketplace-professionals/${fx.y.id}/viewings`), ctx({ professionalId: fx.y.id }))).status).toBe(403);
    expect((await proViewingDetail(url(`/api/marketplace-professionals/${fx.y.id}/viewings/${fx.yViewing.id}`), ctx({ professionalId: fx.y.id, viewingRequestId: fx.yViewing.id }))).status).toBe(403);
    // Another agency's lead or viewing id through the agent's own professional.
    expect((await proLeadDetail(url(`/api/marketplace-professionals/${fx.x.id}/leads/${fx.yLead.id}`), ctx({ professionalId: fx.x.id, leadId: fx.yLead.id }))).status).toBe(404);
    expect((await proViewingDetail(url(`/api/marketplace-professionals/${fx.x.id}/viewings/${fx.yViewing.id}`), ctx({ professionalId: fx.x.id, viewingRequestId: fx.yViewing.id }))).status).toBe(404);

    // Organisation-scoped routes with a forged x-organisation-id: agency Y's backing organisation
    // and the landlord's organisation are both refused.
    for (const organisationId of [fx.y.backingOrganisationId, fx.org.id]) {
      as(fx.tokens.xAgent, organisationId);
      expect((await orgLeads(url("/api/marketplace-leads"))).status).toBe(403);
      expect((await orgLeadDetail(url(`/api/marketplace-leads/${fx.lLead.id}`), ctx({ leadId: fx.lLead.id }))).status).toBe(403);
      expect((await orgViewings(url("/api/viewing-requests"))).status).toBe(403);
      expect((await orgViewingDetail(url(`/api/viewing-requests/${fx.yViewing.id}`), ctx({ viewingRequestId: fx.yViewing.id }))).status).toBe(403);
    }
    // Its own backing organisation works but still only returns that organisation's rows.
    as(fx.tokens.xAgent, fx.x.backingOrganisationId);
    const own = await (await orgLeads(url("/api/marketplace-leads"))).json();
    expect(own.items.map((lead: { id: string }) => lead.id)).toEqual([fx.xLead.id]);
    expect((await orgLeadDetail(url(`/api/marketplace-leads/${fx.yLead.id}`), ctx({ leadId: fx.yLead.id }))).status).toBe(404);
  });

  it("refuses removed, suspended and unrelated users, and archived profiles", async () => {
    for (const token of [fx.tokens.xRemoved, fx.tokens.xSuspended, fx.tokens.stranger, fx.tokens.yOwner, fx.tokens.landlord]) {
      as(token);
      expect((await proLeads(nextUrl(`/api/marketplace-professionals/${fx.x.id}/leads`), ctx({ professionalId: fx.x.id }))).status).toBe(403);
      expect((await proLeadDetail(url(`/api/marketplace-professionals/${fx.x.id}/leads/${fx.xLead.id}`), ctx({ professionalId: fx.x.id, leadId: fx.xLead.id }))).status).toBe(403);
    }
    as(null);
    expect((await proLeads(nextUrl(`/api/marketplace-professionals/${fx.x.id}/leads`), ctx({ professionalId: fx.x.id }))).status).toBe(401);

    await db.marketplaceProfessional.update({ where: { id: fx.x.id }, data: { archivedAt: new Date() } });
    try {
      as(fx.tokens.xAgent);
      expect((await proLeads(nextUrl(`/api/marketplace-professionals/${fx.x.id}/leads`), ctx({ professionalId: fx.x.id }))).status).toBe(404);
      expect((await proViewingDetail(url(`/api/marketplace-professionals/${fx.x.id}/viewings/${fx.xViewing.id}`), ctx({ professionalId: fx.x.id, viewingRequestId: fx.xViewing.id }))).status).toBe(404);
      expect((await (await workspaces()).json()).marketplaceProfessionals).toEqual([]);
    } finally {
      await db.marketplaceProfessional.update({ where: { id: fx.x.id }, data: { archivedAt: null } });
    }
  });

  it("returns explicit detail shapes: private notes only in the website view, internal fields never", async () => {
    as(fx.tokens.xAgent);
    const inbox = await (await proLeadDetail(url(`/api/marketplace-professionals/${fx.x.id}/leads/${fx.xLead.id}?view=inbox`), ctx({ professionalId: fx.x.id, leadId: fx.xLead.id }))).json();
    expect(inbox).toMatchObject({ id: fx.xLead.id, name: "Adjoa Prospect", phone: "+233 24 111 2222", email: "adjoa@example.com", message: "Available in October?", assignee: { user: { displayName: "Kwesi Agent" } } });
    const inboxKeys = keysIn(inbox);
    for (const key of ["privateNotes", "activities", "note", "assigneeMemberId", "marketingConsent", "email" + "Verified"]) expect(inboxKeys.has(key), key).toBe(false);
    expect(JSON.stringify(inbox)).not.toContain("budget is tight");
    expect(JSON.stringify(inbox)).not.toContain("x-agent@agent-inbox.test"); // assignee email
    expectNoInternalFields(inbox);

    const web = await (await proLeadDetail(url(`/api/marketplace-professionals/${fx.x.id}/leads/${fx.xLead.id}`), ctx({ professionalId: fx.x.id, leadId: fx.xLead.id }))).json();
    expect(web.privateNotes).toBe("Staff only: budget is tight.");
    expect(Array.isArray(web.activities)).toBe(true);
    expect(web.viewingRequests[0]).toMatchObject({ id: fx.xViewing.id, preferredTimes: [expect.objectContaining({ timezone: "Africa/Accra" })] });
    expect(JSON.stringify(web)).not.toContain("x-agent@agent-inbox.test");
    expectNoInternalFields(web);

    const viewingInbox = await (await proViewingDetail(url(`/api/marketplace-professionals/${fx.x.id}/viewings/${fx.lViewing.id}?view=inbox`), ctx({ professionalId: fx.x.id, viewingRequestId: fx.lViewing.id }))).json();
    expect(viewingInbox).toMatchObject({ id: fx.lViewing.id, lead: { name: "Third Party Prospect", phone: "0244000111" } });
    expect(keysIn(viewingInbox).has("privateNotes")).toBe(false);
    expectNoInternalFields(viewingInbox);
  });

  it("keeps the website's organisation views complete but free of internal fields, including the CRM dashboard", async () => {
    as(fx.tokens.landlord, fx.org.id);
    const list = await (await orgLeads(url("/api/marketplace-leads"))).json();
    expect(list.items[0]).toMatchObject({ id: fx.lLead.id, name: "Third Party Prospect", phone: "0244000111", listing: { title: "Lamptey House flat" }, viewingRequests: [expect.objectContaining({ id: fx.lViewing.id })], rentalApplications: [] });
    expectNoInternalFields(list);
    const detail = await (await orgLeadDetail(url(`/api/marketplace-leads/${fx.lLead.id}`), ctx({ leadId: fx.lLead.id }))).json();
    expect(detail).toHaveProperty("privateNotes");
    expect(detail).toHaveProperty("assigneeMemberId");
    expectNoInternalFields(detail);
    const viewings = await (await orgViewings(url("/api/viewing-requests"))).json();
    expect(viewings.items[0]).toMatchObject({ id: fx.lViewing.id, lead: { name: "Third Party Prospect" }, preferredTimes: [expect.any(Object)] });
    expectNoInternalFields(viewings);
    const viewing = await (await orgViewingDetail(url(`/api/viewing-requests/${fx.lViewing.id}`), ctx({ viewingRequestId: fx.lViewing.id }))).json();
    expect(viewing).toHaveProperty("privateNotes");
    expectNoInternalFields(viewing);

    const patched = await orgLeadPatch(new Request(`https://nesafric.test/api/marketplace-leads/${fx.lLead.id}`, { method: "PATCH", headers: request.headers, body: JSON.stringify({ privateNotes: "Called back." }) }), ctx({ leadId: fx.lLead.id }));
    expect(patched.status).toBe(200);
    expectNoInternalFields(await patched.json());

    const dashboard = await crmDashboard(url("/api/crm/dashboard"));
    expect(dashboard.status).toBe(200);
    const dashboardBody = await dashboard.json();
    expect(dashboardBody.recentLeads[0]).toMatchObject({ id: fx.lLead.id, assignee: { user: { displayName: "Lamptey Landlord" } } });
    expectNoInternalFields(dashboardBody);
    expect(JSON.stringify(dashboardBody)).not.toContain("landlord@agent-inbox.test");
  });
});
