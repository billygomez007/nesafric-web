/**
 * Manual platform-principal bootstrap (item 8's "manual bootstrap" path). Run by an operator with
 * direct database/deploy access — never exposed through any HTTP endpoint in this application.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-platform-admin.ts user@example.com SUPER_ADMIN
 *   npx tsx scripts/bootstrap-platform-admin.ts user@example.com SUPPORT_AGENT "Temporary support coverage"
 *
 * The target user must already have a PropertyOS account (register normally first); this script
 * only ever grants/updates the separate, independent `PlatformPrincipal` record — it never
 * touches `OrganisationMember`/`Role`/`Permission`.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/platform/database/generated/client";

const VALID_ROLES = ["SUPER_ADMIN", "BILLING_ADMIN", "SUPPORT_AGENT", "READ_ONLY"] as const;

async function main() {
  const [, , emailArg, roleArg, ...noteParts] = process.argv;
  const email = emailArg?.trim().toLowerCase();
  const role = roleArg?.trim().toUpperCase();
  if (!email || !role || !VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    console.error(`Usage: tsx scripts/bootstrap-platform-admin.ts <email> <${VALID_ROLES.join("|")}> [notes]`);
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user account exists for '${email}'. They must register first.`);
      process.exitCode = 1;
      return;
    }
    const principal = await prisma.platformPrincipal.upsert({
      where: { userId: user.id },
      update: { role: role as (typeof VALID_ROLES)[number], status: "ACTIVE", notes: noteParts.join(" ") || undefined },
      create: { userId: user.id, role: role as (typeof VALID_ROLES)[number], status: "ACTIVE", createdVia: "MANUAL", notes: noteParts.join(" ") || undefined },
    });
    console.log(`Platform principal ready: ${email} -> ${principal.role} (id: ${principal.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
