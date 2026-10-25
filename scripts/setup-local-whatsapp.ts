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
 *   npx tsx scripts/setup-local-whatsapp.ts --database <name> [--landlord <phone>] [--tenant <phone>] [--business <phone>]
 *
 * --database must equal the database name in DATABASE_URL, so the operator states which database
 *   is changed.
 * --landlord creates a fixture landlord account with no organisations
 *   (whatsapp-landlord-<number>@nesafric.test) and links that WhatsApp number to it, so "register"
 *   starts landlord onboarding without an SMS code (Arkesel is not needed locally).
 * --business links that number to a fixture account with no business
 *   (whatsapp-business-<number>@nesafric.test), for testing agency, agent and provider registration.
 * --tenant creates a fixture tenant account, a property in "Local Test Homes" and an active lease
 *   for it, and links that number to the tenant, so the number can report repairs straight away.
 *
 * Phones are linked by writing a ChannelIdentity with verificationMethod ADMIN, the same record an
 * SMS code produces. Ordinary registration, SMS codes and webhook signature checks are unchanged.
 *
 * Safe to run again: it reuses its own fixtures. It refuses to:
 * - run against a database that is not on this machine, or not the one named by --database;
 * - take a number that another organisation holds, or run while WHATSAPP_OFFICIAL_ORGANISATION_ID
 *   names any organisation other than its own fixture;
 * - relink a phone that is linked to an account other than its own fixture.
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
  if (process.env.VERCEL) throw new Error("Refusing to run inside a Vercel environment.");
  const url = new URL(required("DATABASE_URL"));
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error(`Refusing to run against database host ${url.hostname}; local databases only.`);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const expectedDatabase = argument("database");
  if (!expectedDatabase) throw new Error(`Pass --database ${databaseName} to confirm the database to change.`);
  if (expectedDatabase !== databaseName) throw new Error(`DATABASE_URL points at "${databaseName}", not "${expectedDatabase}". Nothing was changed.`);
  const phoneNumberId = required("WHATSAPP_LOCAL_PHONE_NUMBER_ID");
  const businessAccountId = required("WHATSAPP_LOCAL_BUSINESS_ACCOUNT_ID");
  const webhookVerifyToken = required("WHATSAPP_LOCAL_VERIFY_TOKEN");
  const landlordPhone = argument("landlord");
  const tenantPhone = argument("tenant");
  const businessPhone = argument("business");
  const configuredOfficial = process.env.WHATSAPP_OFFICIAL_ORGANISATION_ID?.trim();

  // Imported after the environment is loaded: the database client reads DATABASE_URL on import.
  const { db } = await import("@/platform/database/client");
  const { registerUser } = await import("@/modules/identity/service");
  const { createOrganisation } = await import("@/modules/organisations/service");
  const { upsertChannelConfig } = await import("@/modules/conversations/service");
  const { assignWhatsAppNumberForPlatform } = await import("@/modules/platform-admin/service");
  const { linkWhatsAppIdentity } = await import("@/modules/whatsapp-assistant/identity");
  const { normalizeBusinessWhatsAppNumber } = await import("@/modules/business-whatsapp/phone");

  const waId = (phone: string) => normalizeBusinessWhatsAppNumber(phone).replace(/^\+/, "");
  const phones = [landlordPhone, tenantPhone, businessPhone].filter((phone): phone is string => Boolean(phone)).map(waId);
  if (new Set(phones).size !== phones.length) throw new Error("Use a different phone for each of --landlord, --tenant and --business.");
  const user = async (email: string, displayName: string) =>
    (await db.user.findUnique({ where: { email } })) ?? registerUser({ displayName, email, password: `local-${crypto.randomUUID()}` });
  const organisationOwnedBy = async (ownerId: string, name: string, create: () => Promise<{ id: string }>) =>
    (await db.organisation.findFirst({ where: { name, members: { some: { userId: ownerId } } } })) ?? create();

  try {
    // Every refusal happens here, before anything is written.
    const existingOwner = await db.user.findUnique({ where: { email: OWNER_EMAIL } });
    const existingOfficial = existingOwner && await db.organisation.findFirst({ where: { name: OFFICIAL_NAME, members: { some: { userId: existingOwner.id } } } });
    if (configuredOfficial && configuredOfficial !== existingOfficial?.id) {
      throw new Error("WHATSAPP_OFFICIAL_ORGANISATION_ID names an organisation this script did not create. Remove it from .env.local to use the local test organisation. Nothing was changed.");
    }
    const holder = await db.whatsAppNumberAssignment.findUnique({ where: { activePhoneNumberId: phoneNumberId } });
    if (holder && holder.organisationId !== existingOfficial?.id) throw new Error(`Number ${phoneNumberId} is assigned to another organisation; release it there first. Nothing was changed.`);
    // Each phone may only already be linked to the fixture account this script makes for it.
    const landlordEmail = landlordPhone ? `whatsapp-landlord-${waId(landlordPhone)}@nesafric.test` : null;
    const tenantEmail = tenantPhone ? `tenant-${waId(tenantPhone)}@nesafric.test` : null;
    const businessEmail = businessPhone ? `whatsapp-business-${waId(businessPhone)}@nesafric.test` : null;
    for (const [phone, email] of [[landlordPhone, landlordEmail], [tenantPhone, tenantEmail], [businessPhone, businessEmail]] as const) {
      if (!phone || !email) continue;
      const identity = await db.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address: `+${waId(phone)}` } }, include: { user: { select: { email: true } } } });
      if (identity?.userId && identity.user?.email !== email) throw new Error(`${phone} is already linked to another account; unlink it there first. Nothing was changed.`);
    }

    const owner = existingOwner ?? await user(OWNER_EMAIL, "NesAfric Support");
    const official = existingOfficial ?? await createOrganisation(owner.id, { name: OFFICIAL_NAME, type: "OTHER", countryCode: "GH" });
    // The number is recorded as official only if this is set before it is assigned.
    process.env.WHATSAPP_OFFICIAL_ORGANISATION_ID = official.id;

    const adminUser = await user(ADMIN_EMAIL, "NesAfric Platform (local)");
    const admin = await db.platformPrincipal.upsert({
      where: { userId: adminUser.id },
      update: { role: "SUPER_ADMIN", status: "ACTIVE" },
      create: { userId: adminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL", notes: "Local WhatsApp testing" },
    });
    const assignment = await assignWhatsAppNumberForPlatform(admin, { organisationId: official.id, phoneNumberId, businessAccountId, reason: "Local WhatsApp test number" });
    await upsertChannelConfig(owner.id, official.id, "WHATSAPP", { enabled: true, webhookVerifyToken, config: { marketplaceAssistantEnabled: true, defaultCountry: "GH", defaultCurrency: "GHS" } });
    console.log(`Official organisation ready; number ${phoneNumberId} ${assignment.changed ? "assigned" : "already assigned"}.`);

    const link = async (phone: string, userId: string, organisationId: string) => {
      const identity = await db.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address: `+${waId(phone)}` } } });
      if (identity?.userId === userId && identity.verifiedAt) return;
      await linkWhatsAppIdentity(waId(phone), userId, "ADMIN", organisationId);
    };

    if (landlordPhone) {
      const landlord = await user(landlordEmail!, "Local Test Landlord");
      await link(landlordPhone, landlord.id, official.id);
      console.log(`Linked ${landlordPhone} to ${landlordEmail}: send "register" to start landlord onboarding.`);
    }

    if (businessPhone) {
      // An account with no business yet: for registering an agency, agent or service provider.
      const account = await user(businessEmail!, "Local Test Business Owner");
      await link(businessPhone, account.id, official.id);
      console.log(`Linked ${businessPhone} to ${businessEmail}: send "register agency", "register agent" or "register services".`);
    }

    if (tenantPhone) {
      const { createProperty } = await import("@/modules/assets/service");
      const { createTenant } = await import("@/modules/tenants/service");
      const { createLease } = await import("@/modules/leases/service");
      const homes = await organisationOwnedBy(owner.id, TEST_HOMES, () => createOrganisation(owner.id, { name: TEST_HOMES, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" }));
      const id = waId(tenantPhone);
      // One property, unit and lease per tenant phone, so each tester reports against their own.
      const propertyName = `Palm Court ${id.slice(-4)}`;
      const property = (await db.property.findFirst({ where: { organisationId: homes.id, referenceNumber: `LOCAL-P-${id}` } }))
        ?? await createProperty(owner.id, homes.id, { name: propertyName, referenceNumber: `LOCAL-P-${id}`, category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
      const unit = await db.unit.findFirstOrThrow({ where: { propertyId: property.id } });
      const tenantUser = await user(tenantEmail!, "Local Test Tenant");
      let relationship = await db.tenantOrganisation.findFirst({ where: { organisationId: homes.id, userId: tenantUser.id } });
      if (!relationship) {
        relationship = (await createTenant(owner.id, homes.id, { legalName: "Local Test Tenant" })).relationship;
        await db.tenantOrganisation.update({ where: { id: relationship.id }, data: { userId: tenantUser.id } });
      }
      const lease = (await db.lease.findUnique({ where: { organisationId_referenceNumber: { organisationId: homes.id, referenceNumber: `LOCAL-L-${id}` } } }))
        ?? await createLease(owner.id, homes.id, { referenceNumber: `LOCAL-L-${id}`, propertyId: property.id, unitId: unit.id, tenantOrganisationIds: [relationship.id], startDate: "2026-01-01", rentAmountMinor: "100000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT" });
      if (lease.status !== "ACTIVE") await db.lease.update({ where: { id: lease.id }, data: { status: "ACTIVE", executionStatus: "ACTIVE" } });
      await link(tenantPhone, tenantUser.id, homes.id);
      console.log(`Linked ${tenantPhone} as the tenant of ${TEST_HOMES}, ${propertyName} A1: send "report" or describe a repair.`);
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
