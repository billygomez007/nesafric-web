import type { Prisma, User } from "@/platform/database/generated/client";
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
  // Only an address its owner has proved (email code or Google). A listed address someone merely
  // typed into an unverified account grants nothing (H-4); the owner's first proof clears that
  // account's claimant (`claimEmailOnFirstProof`) before this ever matches it.
  const users = await db.user.findMany({ where: { email: { in: emails }, emailVerifiedAt: { not: null } } });
  for (const user of users) {
    await db.platformPrincipal.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "ENV_BOOTSTRAP" },
    });
  }
}

/**
 * The one way to read a principal for an authorization decision. An `ENV_BOOTSTRAP` principal
 * exists only because its user's email is on the bootstrap list, so it is usable only while all of
 * this holds right now (H-4):
 *
 * - the principal is ACTIVE;
 * - the user's current email is verified;
 * - that email (normalised) is still in `PLATFORM_ADMIN_BOOTSTRAP_EMAILS`.
 *
 * Checked every time a principal is read, however and whenever the row was created — so a grant
 * made before verification was required, an account that later proved some *other* address, or an
 * address removed from the list all fail closed. A missing or stale list fails closed too; no row
 * is ever deleted here. `MANUAL` principals (operator-created) are unaffected.
 */
export async function findUsablePlatformPrincipal(client: Pick<Prisma.TransactionClient, "platformPrincipal">, userId: string) {
  const principal = await client.platformPrincipal.findUnique({ where: { userId }, include: { user: { select: { email: true, emailVerifiedAt: true } } } });
  if (!principal) return null;
  if (principal.createdVia === "ENV_BOOTSTRAP") {
    const email = principal.user.email?.trim().toLowerCase();
    const bound = principal.status === "ACTIVE" && Boolean(principal.user.emailVerifiedAt) && Boolean(email) && bootstrapEmails().includes(email!);
    if (!bound) return null;
  }
  const { user: _user, ...usable } = principal;
  return usable;
}

export async function getOptionalPlatformPrincipal(user: User | null) {
  if (!user) return null;
  await ensurePlatformBootstrap();
  return findUsablePlatformPrincipal(db, user.id);
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
