/**
 * ============================================================================
 * DEVELOPMENT / DEMO TOOLING ONLY — NOT FOR PRODUCTION USE
 * ============================================================================
 *
 * Local-only demo data for visually inspecting PropertyOS (not part of `db:seed`, which only
 * seeds foundational reference data — country/currency/permissions/roles/plans). This script
 * drives the same application service functions the API routes and tests use, so every record
 * respects real validation, RBAC, entitlements, and audit/domain events exactly like production
 * traffic would. Safe to run only against a local/dev database that already has migrations and
 * `db:seed` applied.
 *
 * Safety properties:
 * - Refuses to run when `NODE_ENV=production` (see the guard at the top of `main()`).
 * - The demo password is a fixed, hardcoded, clearly-fake string — never read from `.env` or any
 *   other configuration, so it can never collide with or leak a real credential.
 * - Every demo user's email uses the `@propertyos.demo` domain (not a real TLD) and every demo
 *   display name/organisation name is suffixed "(Demo)", so demo records are unmistakable in any
 *   list view, audit log, or database query — see `DEMO_TAG`.
 * - Only ever *creates* records; it never deletes, updates, or archives anything that already
 *   exists, so it cannot overwrite or destroy legitimate non-demo data.
 * - Idempotent in practice: if the demo organisation already exists, it exits immediately as a
 *   safe no-op instead of creating duplicates.
 * - Does not grant platform-administration access itself. Promoting the demo platform-admin
 *   account is a separate, explicit, operator-run step (`npm run platform-admin:bootstrap`),
 *   exactly like it would be for a real platform administrator — this script never bypasses that.
 *
 * Usage: `npm run seed:demo`
 */
import "dotenv/config";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createPortfolio, createProperty } from "@/modules/assets/service";
import { createTenant } from "@/modules/tenants/service";
import { createLease } from "@/modules/leases/service";
import { generateRentSchedule } from "@/modules/rent-schedules/service";
import { createManualPayment } from "@/modules/payments/service";
import { createMaintenanceRequest, transitionMaintenanceRequest, createWorkOrder } from "@/modules/maintenance/service";
import { createServiceProvider, addProviderToDirectory, submitProviderVerification, reviewProviderVerification } from "@/modules/providers/service";
import { createListing, updateListingVerification, transitionListing } from "@/modules/listings/service";
import { createMarketplaceLead, createViewingRequest } from "@/modules/listings/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { createDevelopment, createDevelopmentUnit } from "@/modules/developments/service";
import { db } from "@/platform/database/client";

const DEMO_PASSWORD = "DemoPassword123!";
const DEMO_ORGANISATION_NAME = "Golden Coast Properties (Demo)";
const DEMO_NOTE = "Demo/sample data created by scripts/seed-demo.ts — not a real person or record.";

async function activateLease(leaseId: string) {
  return db.lease.update({ where: { id: leaseId }, data: { status: "ACTIVE", executionStatus: "ACTIVE" } });
}

async function verifyAndPublish(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING",
    evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/demo-title-deed.pdf", metadata: { review: "manual-ready", kycPerformed: false } }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED", note: "Demo asset authority checked." });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refusing to run: scripts/seed-demo.ts creates fake development/demo accounts and data " +
      "and must never run against a production environment. NODE_ENV is 'production'; aborting.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("============================================================");
  console.log(" PropertyOS DEMO data seeder — development/demo tooling only");
  console.log(" Do not point this at a production database.");
  console.log("============================================================\n");

  const existing = await db.organisation.findFirst({ where: { name: DEMO_ORGANISATION_NAME } });
  if (existing) {
    console.log(`Demo organisation '${DEMO_ORGANISATION_NAME}' already exists — skipping seeding to avoid duplicates (safe to rerun).`);
    console.log("To reseed from scratch: drop/recreate the database, then rerun db:deploy, db:seed, and this script.");
    return;
  }

  console.log("Registering demo users...");
  const landlord = await registerUser({ displayName: "Kwame Mensah (Demo Landlord)", email: "landlord@propertyos.demo", password: DEMO_PASSWORD });
  const manager = await registerUser({ displayName: "Ama Boateng (Demo Property Manager)", email: "manager@propertyos.demo", password: DEMO_PASSWORD });
  const platformAdminUser = await registerUser({ displayName: "NesAfric Admin (Demo Platform Admin)", email: "platform-admin@propertyos.demo", password: DEMO_PASSWORD });
  const providerUser = await registerUser({ displayName: "Kojo Plumbing Services (Demo Provider)", email: "provider@propertyos.demo", password: DEMO_PASSWORD });
  const prospect = await registerUser({ displayName: "Abena Prospect (Demo Prospect)", email: "prospect@propertyos.demo", password: DEMO_PASSWORD });
  const brokerUser = await registerUser({ displayName: "Adjoa Brokerage (Demo Brokerage)", email: "broker@propertyos.demo", password: DEMO_PASSWORD });
  const developerUser = await registerUser({ displayName: "Coastal Developments (Demo Developer)", email: "developer@propertyos.demo", password: DEMO_PASSWORD });

  console.log("Creating demo organisation...");
  const organisation = await createOrganisation(landlord.id, { name: DEMO_ORGANISATION_NAME, type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

  const propertyManagerRole = await db.role.findUniqueOrThrow({ where: { key: "property_manager" } });
  const managerMember = await db.organisationMember.create({ data: { organisationId: organisation.id, userId: manager.id } });
  await db.membershipRole.create({ data: { memberId: managerMember.id, roleId: propertyManagerRole.id } });

  console.log("Creating portfolios and properties...");
  const accraPortfolio = await createPortfolio(landlord.id, organisation.id, { name: "Accra Residential Portfolio" });
  const kumasiPortfolio = await createPortfolio(landlord.id, organisation.id, { name: "Kumasi Residential Portfolio" });

  const oceanView = await createProperty(landlord.id, organisation.id, {
    name: "Ocean View Apartments", referenceNumber: "OVA-001", category: "Residential", countryCode: "GH", currencyCode: "GHS",
    city: "Accra", addressLine1: "12 Cantonments Road, Osu", portfolioId: accraPortfolio.id,
    building: { name: "Ocean View Block A", units: [{ name: "A1", unitType: "2-bedroom", bedrooms: 2, bathrooms: 1 }, { name: "A2", unitType: "3-bedroom", bedrooms: 3, bathrooms: 2 }, { name: "A3", unitType: "1-bedroom", bedrooms: 1, bathrooms: 1 }, { name: "A4", unitType: "2-bedroom", bedrooms: 2, bathrooms: 1 }] },
  });
  const kumasiGarden = await createProperty(landlord.id, organisation.id, {
    name: "Kumasi Garden Homes", referenceNumber: "KGH-001", category: "Residential", countryCode: "GH", currencyCode: "GHS",
    city: "Kumasi", addressLine1: "7 Ridge Avenue, Nhyiaeso", portfolioId: kumasiPortfolio.id,
    units: [{ name: "K1", unitType: "3-bedroom house", bedrooms: 3, bathrooms: 2 }, { name: "K2", unitType: "2-bedroom house", bedrooms: 2, bathrooms: 1 }],
  });

  const units = await db.unit.findMany({ where: { propertyId: { in: [oceanView.id, kumasiGarden.id] } } });
  const unit = (propertyId: string, name: string) => units.find((u) => u.propertyId === propertyId && u.name === name)!;
  // A4 and K2 are intentionally left unassigned below — they stay vacant, free for browsing.
  const a1 = unit(oceanView.id, "A1"), a2 = unit(oceanView.id, "A2"), a3 = unit(oceanView.id, "A3");
  const k1 = unit(kumasiGarden.id, "K1");

  console.log("Creating tenants, leases, rent schedules, and payments...");
  const kofi = await createTenant(landlord.id, organisation.id, { legalName: "Kofi Owusu (Demo Tenant)", email: "kofi.owusu@example.com", phone: "+233241000001", city: "Accra", countryCode: "GH", notes: DEMO_NOTE });
  const efua = await createTenant(landlord.id, organisation.id, { legalName: "Efua Mensah (Demo Tenant)", email: "efua.mensah@example.com", phone: "+233241000002", city: "Accra", countryCode: "GH", notes: DEMO_NOTE });
  const yaw = await createTenant(landlord.id, organisation.id, { legalName: "Yaw Asante (Demo Tenant)", email: "yaw.asante@example.com", phone: "+233241000003", city: "Kumasi", countryCode: "GH", notes: DEMO_NOTE });

  // A1 — active lease with six months of recorded payment history, leaving recent months due/overdue.
  const leaseKofi = await createLease(landlord.id, organisation.id, {
    referenceNumber: "LEASE-A1-2026", propertyId: oceanView.id, unitId: a1.id, tenantOrganisationIds: [kofi.relationship.id],
    startDate: "2026-01-01", endDate: "2026-12-31", rentAmountMinor: "250000", depositAmountMinor: "250000",
    currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT",
  });
  await activateLease(leaseKofi.id);
  await generateRentSchedule(landlord.id, organisation.id, leaseKofi.id, 12);
  const kofiObligations = await db.rentObligation.findMany({ where: { leaseId: leaseKofi.id }, orderBy: { dueDate: "asc" } });
  for (const [index, obligation] of kofiObligations.slice(0, 6).entries()) {
    await createManualPayment(landlord.id, organisation.id, {
      tenantOrganisationId: kofi.relationship.id, leaseId: leaseKofi.id, amountMinor: "250000", currencyCode: "GHS",
      paidAt: new Date(2026, index, 5, 10, 0).toISOString(), method: "MOBILE_MONEY", externalReference: `momo-kofi-${index + 1}`,
      evidenceReference: `demo/evidence/momo-kofi-${index + 1}.jpg`,
      idempotencyKey: `demo-kofi-${index + 1}`, allocations: [{ rentObligationId: obligation.id, amountMinor: "250000" }],
    });
  }

  // A2 — active lease with partial (three months) payment history.
  const leaseEfua = await createLease(landlord.id, organisation.id, {
    referenceNumber: "LEASE-A2-2026", propertyId: oceanView.id, unitId: a2.id, tenantOrganisationIds: [efua.relationship.id],
    startDate: "2026-03-01", endDate: "2027-02-28", rentAmountMinor: "300000", depositAmountMinor: "300000",
    currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT",
  });
  await activateLease(leaseEfua.id);
  await generateRentSchedule(landlord.id, organisation.id, leaseEfua.id, 10);
  const efuaObligations = await db.rentObligation.findMany({ where: { leaseId: leaseEfua.id }, orderBy: { dueDate: "asc" } });
  for (const [index, obligation] of efuaObligations.slice(0, 3).entries()) {
    await createManualPayment(landlord.id, organisation.id, {
      tenantOrganisationId: efua.relationship.id, leaseId: leaseEfua.id, amountMinor: "300000", currencyCode: "GHS",
      paidAt: new Date(2026, 2 + index, 3, 9, 0).toISOString(), method: "BANK_TRANSFER", externalReference: `bank-efua-${index + 1}`,
      evidenceReference: `demo/evidence/bank-efua-${index + 1}.pdf`,
      idempotencyKey: `demo-efua-${index + 1}`, allocations: [{ rentObligationId: obligation.id, amountMinor: "300000" }],
    });
  }

  // K1 — active lease with no payments yet, to demonstrate overdue-tenant handling.
  const leaseYaw = await createLease(landlord.id, organisation.id, {
    referenceNumber: "LEASE-K1-2026", propertyId: kumasiGarden.id, unitId: k1.id, tenantOrganisationIds: [yaw.relationship.id],
    startDate: "2026-06-01", endDate: "2027-05-31", rentAmountMinor: "180000", depositAmountMinor: "180000",
    currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT",
  });
  await activateLease(leaseYaw.id);
  await generateRentSchedule(landlord.id, organisation.id, leaseYaw.id, 8);

  // A3, A4, K2 stay vacant — used below for a published listing and left free for browsing.
  console.log("Creating a maintenance request with a triaged, assigned work order...");
  await createMaintenanceRequest(landlord.id, organisation.id, {
    propertyId: oceanView.id, unitId: a1.id, title: "Leaking kitchen tap", description: "The kitchen tap in A1 has been dripping constantly for two days.", category: "plumbing",
  });
  const windowRequest = await createMaintenanceRequest(landlord.id, organisation.id, {
    propertyId: oceanView.id, unitId: a2.id, title: "Broken window latch", description: "The bedroom window latch in A2 no longer locks securely.", category: "carpentry", priority: "URGENT",
  });
  await transitionMaintenanceRequest(manager.id, organisation.id, windowRequest.id, { status: "TRIAGED", note: "Confirmed on-site; scheduling a work order." });
  await createWorkOrder(manager.id, organisation.id, windowRequest.id, {
    title: "Replace window latch — Unit A2", description: "Supply and fit a new security latch.", assigneeMemberId: managerMember.id,
    estimateAmountMinor: "45000", currencyCode: "GHS",
  });

  console.log("Creating a verified service provider...");
  const categories = await db.serviceCategory.findMany({ where: { key: { in: ["plumbing", "carpentry"] } } });
  const provider = await createServiceProvider(providerUser.id, {
    type: "INDIVIDUAL", displayName: "Kojo Plumbing Services (Demo)", contactEmail: "provider@propertyos.demo", contactPhone: "+233201000009",
    categoryIds: categories.map((category) => category.id), serviceAreas: [{ areaType: "operational-zone", name: "Greater Accra", reference: "zone:accra" }],
  });
  await addProviderToDirectory(landlord.id, organisation.id, { providerId: provider.id, internalNotes: "Reliable plumber, responsive on WhatsApp." });
  await submitProviderVerification(providerUser.id, provider.id, { evidence: [{ type: "IDENTITY", reference: "demo/evidence/ghana-card.jpg" }] });
  await reviewProviderVerification(landlord.id, organisation.id, provider.id, { status: "VERIFIED", reason: "Identity and contact details confirmed for the demo." });

  console.log("Publishing a listing and recording a lead + viewing request...");
  const listing = await createListing(landlord.id, organisation.id, {
    propertyId: oceanView.id, unitId: a3.id, listingType: "RENT", category: "apartment",
    title: "Bright one-bedroom apartment in Osu", publicDescription: "A bright, well-maintained one-bedroom apartment with flexible viewing availability, walking distance to Oxford Street.",
    rentAmountMinor: "220000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-15",
    bedrooms: 1, bathrooms: 1, sizeSqm: 55, countryCode: "GH", region: "Greater Accra", city: "Accra", district: "Osu",
    media: [{ type: "PHOTO", publicUrl: "https://placehold.co/1200x800/png?text=Ocean+View+A3", altText: "Ocean View Apartments, Unit A3 — living room" }],
  });
  await verifyAndPublish(landlord.id, organisation.id, listing.id);
  await createMarketplaceLead(listing.id, undefined, { name: "Anonymous Prospect", phone: "+233241000099", message: "Is this apartment still available for a September move-in?", source: "demo-seed" });
  const prospectLead = await createMarketplaceLead(listing.id, prospect.id, { name: "Abena Prospect", email: "prospect@propertyos.demo", marketingConsent: true });
  const viewingStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const viewingEnd = new Date(viewingStart.getTime() + 60 * 60 * 1000);
  await createViewingRequest(listing.id, prospect.id, {
    leadId: prospectLead.id,
    preferredTimes: [{ startsAt: viewingStart.toISOString(), endsAt: viewingEnd.toISOString(), timezone: "Africa/Accra" }],
    requesterNote: "Available any afternoon that week.",
  });

  console.log("Creating a marketplace brokerage profile...");
  await createMarketplaceProfessional(brokerUser.id, {
    type: "BROKERAGE", displayName: "Adjoa Brokerage (Demo)", countryCode: "GH",
    description: "Demo brokerage profile for marketplace QA.", contactEmail: "broker@propertyos.demo",
    specialities: ["residential", "rentals"], serviceAreas: ["Greater Accra"],
  });

  console.log("Creating a marketplace developer profile with a development and unit...");
  const developerProfile = await createMarketplaceProfessional(developerUser.id, {
    type: "DEVELOPER", displayName: "Coastal Developments (Demo)", countryCode: "GH",
    description: "Demo developer profile for marketplace QA.", contactEmail: "developer@propertyos.demo",
  });
  const development = await createDevelopment(developerUser.id, developerProfile.id, {
    name: "Coastal Breeze Estate (Demo)", description: "A demo residential development for marketplace QA.",
    countryCode: "GH", region: "Greater Accra", city: "Accra", district: "East Legon",
  });
  await createDevelopmentUnit(developerUser.id, developerProfile.id, development.id, {
    name: "Block B, Unit 3", unitType: "3-bedroom townhouse", bedrooms: 3, bathrooms: 2, sizeSqm: 180, priceMinor: "85000000", currencyCode: "GHS",
  });

  console.log("\nDemo data created.\n");
  console.log("Registered demo users (all share the password below) — DEVELOPMENT/DEMO CREDENTIALS ONLY,");
  console.log("never valid against and never to be used against a production deployment:");
  console.log(`  Password for every demo account: ${DEMO_PASSWORD}`);
  console.log(`  Landlord / organisation owner : ${landlord.email}`);
  console.log(`  Property manager (staff)      : ${manager.email}`);
  console.log(`  Platform admin (not yet promoted — see next step): ${platformAdminUser.email}`);
  console.log(`  Service provider login        : ${providerUser.email}`);
  console.log(`  Prospect / marketplace visitor: ${prospect.email}`);
  console.log(`  Marketplace brokerage login    : ${brokerUser.email}`);
  console.log(`  Marketplace developer login    : ${developerUser.email}`);
  console.log("\nNext step (also development-only — never exposed through any HTTP endpoint):");
  console.log(`  npm run platform-admin:bootstrap -- ${platformAdminUser.email} SUPER_ADMIN`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
