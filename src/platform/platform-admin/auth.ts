import type { User } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { forbidden } from "@/platform/errors";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission, type PlatformPermission } from "./permissions";

function bootstrapEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAILS;
  if (!raw) return [];
  return [...new Set(raw.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Idempotent, env-variable-driven platform-principal bootstrap (item 8). Promotes any existing
 * `User` whose email is listed in `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` to a `SUPER_ADMIN`
 * `PlatformPrincipal`, if they do not already have one. This is the *only* automatic path to
 * platform access — there is no HTTP endpoint anywhere in this application that creates or
 * promotes a `PlatformPrincipal`. The alternative, non-automatic path is a manual, operator-run
 * script (`scripts/bootstrap-platform-admin.ts`) for ad-hoc promotion outside of environment
 * configuration. Safe to call on every request: it is a handful of indexed lookups and upserts,
 * and a no-op entirely when the environment variable is unset.
 */
export async function ensurePlatformBootstrap() {
  const emails = bootstrapEmails();
  if (!emails.length) return;
  const users = await db.user.findMany({ where: { email: { in: emails } } });
  for (const user of users) {
    await db.platformPrincipal.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "ENV_BOOTSTRAP" },
    });
  }
}

export async function getOptionalPlatformPrincipal(user: User | null) {
  if (!user) return null;
  await ensurePlatformBootstrap();
  return db.platformPrincipal.findUnique({ where: { userId: user.id } });
}

/**
 * The platform-admin authorization guard (item 8). Deliberately takes an already-authenticated
 * `User` (from the *same* login/session system every other page uses) but resolves authorization
 * exclusively via `PlatformPrincipal` — never `OrganisationMember`. A landlord with even an
 * `organisation_owner` role on every organisation they belong to still gets `forbidden()` here
 * unless a `PlatformPrincipal` row was created for them through bootstrap.
 */
export async function requirePlatformPrincipal(user: User | null, permission?: PlatformPermission) {
  const principal = await getOptionalPlatformPrincipal(user);
  if (!principal || principal.status !== "ACTIVE") throw forbidden();
  if (permission && !platformRoleHasPermission(principal.role, permission)) throw forbidden();
  return principal;
}

export { PLATFORM_PERMISSIONS };
