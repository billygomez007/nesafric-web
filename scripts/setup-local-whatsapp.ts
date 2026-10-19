/**
 * ============================================================================
 * LOCAL WHATSAPP TESTING ONLY — NOT FOR PRODUCTION USE
 * ============================================================================
 *
 * Connects Meta's WhatsApp test number to a local database, the way production is set up
 * (docs/whatsapp-operations.md), so real WhatsApp messages can reach `next dev` through a tunnel.
 *
 * Reads from .env.local (then .env):
 *   WHATSAPP_LOCAL_PHONE_NUMBER_ID      phone number ID of the Meta test number
 *   WHATSAPP_LOCAL_BUSINESS_ACCOUNT_ID  WhatsApp Business Account ID
 *   WHATSAPP_LOCAL_VERIFY_TOKEN         the verify token typed into Meta's webhook settings
 *
 * Usage:
 *   npx tsx scripts/setup-local-whatsapp.ts [--landlord <phone>] [--tenant <phone>]
 *
 * --landlord links that WhatsApp number to the official organisation's owner, so "register"
 *   starts landlord onboarding without an SMS code (Arkesel is not needed locally).
 * --tenant creates "Local Test Homes" (a property, a unit and an active lease) and links that
 *   number to its tenant, so the number can report repairs straight away.
 *
 * Safe to run again: it reuses what it created before. It refuses to run against anything but a
 * database on this machine.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const OFFICIAL_NAME = "NesAfric (Local WhatsApp Test)";
const TEST_HOMES = "Local Test Homes";
const OWNER_EMAIL = "whatsapp-owner@nesafric.test";
const ADMIN_EMAIL = "whatsapp-platform@nesafric.test";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .env.local.`);
  return value;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production.");
  const host = new URL(required("DATABASE_URL")).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`Refusing to run against database host ${host}; local databases only.`);
  const phoneNumberId = required("WHATSAPP_LOCAL_PHONE_NUMBER_ID");
  const businessAccountId = required("WHATSAPP_LOCAL_BUSINESS_ACCOUNT_ID");
  const webhookVerifyToken = required("WHATSAPP_LOCAL_VERIFY_TOKEN");
  const landlordPhone = argument("landlord");
  const tenantPhone = argument("tenant");

  // Imported after the environment is loaded: the database client reads DATABASE_URL on import.
  const { db } = await import("@/platform/database/client");
  const { registerUser } = await import("@/modules/identity/service");
  const { createOrganisation } = await import("@/modules/organisations/service");
  const { upsertChannelConfig } = await import("@/modules/conversations/service");
  const { assignWhatsAppNumberForPlatform } = await import("@/modules/platform-admin/service");
  const { linkWhatsAppIdentity } = await import("@/modules/whatsapp-assistant/identity");
  const { normalizeBusinessWhatsAppNumber } = await import("@/modules/business-whatsapp/phone");

  const waId = (phone: string) => normalizeBusinessWhatsAppNumber(phone).replace(/^\+/, "");
  const user = async (email: string, displayName: string) =>
    (await db.user.findUnique({ where: { email } })) ?? registerUser({ displayName, email, password: `local-${crypto.randomUUID()}` });
  const organisationOwnedBy = async (ownerId: string, name: string, create: () => Promise<{ id: string }>) =>
    (await db.organisation.findFirst({ where: { name, members: { some: { userId: ownerId } } } })) ?? create();

  try {
    const owner = await user(OWNER_EMAIL, "NesAfric Support");
    const official = await organisationOwnedBy(owner.id, OFFICIAL_NAME, () => createOrganisation(owner.id, { name: OFFICIAL_NAME, type: "OTHER", countryCode: "GH" }));
    // The number is recorded as official only if this is set before it is assigned.
    process.env.WHATSAPP_OFFICIAL_ORGANISATION_ID = official.id;

    const adminUser = await user(ADMIN_EMAIL, "NesAfric Platform (local)");
    const admin = await db.platformPrincipal.upsert({
      where: { userId: adminUser.id },
      update: { role: "SUPER_ADMIN", status: "ACTIVE" },
      create: { userId: adminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL", notes: "Local WhatsApp testing" },
    });
    const assignment = await assignWhatsAppNumberForPlatform(admin, { organisationId: official.id, phoneNumberId, businessAccountId, move: true, reason: "Local WhatsApp test number" });
    await upsertChannelConfig(owner.id, official.id, "WHATSAPP", { enabled: true, webhookVerifyToken, config: { marketplaceAssistantEnabled: true, defaultCountry: "GH", defaultCurrency: "GHS" } });
    console.log(`Official organisation ready; number ${phoneNumberId} ${assignment.changed ? "assigned" : "already assigned"}.`);

    if (landlordPhone) {
      await linkWhatsAppIdentity(waId(landlordPhone), owner.id, "ADMIN", official.id);
      console.log(`Linked ${landlordPhone} to ${OWNER_EMAIL}: send "register" to start landlord onboarding.`);
    }

    if (tenantPhone) {
      const { createProperty } = await import("@/modules/assets/service");
      const { createTenant } = await import("@/modules/tenants/service");
      const { createLease } = await import("@/modules/leases/service");
      const homes = await organisationOwnedBy(owner.id, TEST_HOMES, () => createOrganisation(owner.id, { name: TEST_HOMES, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" }));
      const property = (await db.property.findFirst({ where: { organisationId: homes.id } }))
        ?? await createProperty(owner.id, homes.id, { name: "Palm Court", referenceNumber: "LOCAL-PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
      const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
      const id = waId(tenantPhone);
      const tenantUser = await user(`tenant-${id}@nesafric.test`, "Local Test Tenant");
      let relationship = await db.tenantOrganisation.findFirst({ where: { organisationId: homes.id, userId: tenantUser.id } });
      if (!relationship) {
        relationship = (await createTenant(owner.id, homes.id, { legalName: "Local Test Tenant" })).relationship;
        await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
      }
      if (!(await db.lease.findFirst({ where: { organisationId: homes.id, unitId: unit.id, status: "ACTIVE" } }))) {
        const lease = await createLease(owner.id, homes.id, { referenceNumber: `LOCAL-L-${id}`, propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT" });
        await db.lease.update({ where: { id: lease.id }, data: { status: "ACTIVE", executionStatus: "ACTIVE" } });
      }
      await linkWhatsAppIdentity(id, tenantUser.id, "ADMIN", homes.id);
      console.log(`Linked ${tenantPhone} as the tenant of ${TEST_HOMES}, Palm Court A1: send "report" or describe a repair.`);
    }

    console.log(`\nAdd to .env.local, then restart next dev:\nWHATSAPP_OFFICIAL_ORGANISATION_ID=${official.id}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
