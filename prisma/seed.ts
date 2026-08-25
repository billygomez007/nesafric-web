import "dotenv/config";
import { PrismaClient } from "../src/platform/database/generated/client";
import { GHANA, GHS } from "../src/modules/geography/config";

const prisma = new PrismaClient();

const permissions = [
  ["organisation.manage_members", "Invite and manage organisation members"],
  ["property.create", "Create properties and related assets"],
  ["property.read", "View properties and related assets"],
  ["property.update", "Update properties and related assets"],
  ["portfolio.create", "Create portfolios"],
  ["audit.read", "View organisation audit history"],
  ["tenant.create", "Create tenant records"],
  ["tenant.read", "View tenant records and history"],
  ["tenant.update", "Update tenant records"],
  ["lease.create", "Create leases"],
  ["lease.read", "View leases and lease history"],
  ["lease.update", "Update lease terms and status"],
  ["reminder.manage", "Manage reminder policies and jobs"],
  ["rent_schedule.manage", "Generate rent obligation schedules"],
] as const;

async function main() {
  await prisma.country.upsert({ where: { code: GHANA.code }, update: GHANA, create: GHANA });
  await prisma.currency.upsert({ where: { code: GHS.code }, update: GHS, create: GHS });
  for (const [key, description] of permissions) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const allPermissions = await prisma.permission.findMany();
  const roles = [
    { key: "organisation_owner", name: "Organisation owner", keys: allPermissions.map(({ key }) => key) },
    { key: "administrator", name: "Administrator", keys: allPermissions.map(({ key }) => key) },
    { key: "property_manager", name: "Property manager", keys: ["property.create", "property.read", "property.update", "portfolio.create", "tenant.create", "tenant.read", "tenant.update", "lease.create", "lease.read", "lease.update", "reminder.manage", "rent_schedule.manage"] },
    { key: "viewer", name: "Viewer", keys: ["property.read", "tenant.read", "lease.read"] },
  ];
  for (const definition of roles) {
    const role = await prisma.role.upsert({ where: { key: definition.key }, update: { name: definition.name }, create: { key: definition.key, name: definition.name } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: allPermissions.filter(({ key }) => definition.keys.includes(key)).map(({ id }) => ({ roleId: role.id, permissionId: id })) });
  }
}

main().finally(() => prisma.$disconnect());
