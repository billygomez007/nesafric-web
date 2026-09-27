import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { notFound } from "@/platform/errors";
import { isUuid } from "@/platform/validation/uuid";
import { publicMarketplaceProvidersById } from "./service";

/**
 * Saved service providers: a signed-in user's own bookmarks, stored server-side.
 *
 * - Every operation is scoped to the authenticated user id; there is no way to name another user.
 * - Saving never changes ranking, verification or eligibility.
 * - Only a provider that is publicly listed right now can be saved (anything else is 404, exactly
 *   like the public profile), so saving can't be used to probe hidden providers.
 * - Reading the list re-applies the public marketplace gates: a provider that has since been
 *   unlisted, unverified, suspended or archived comes back as `{ available: false, provider: null }`
 *   with no name or other detail, so Saved can never re-publish it.
 */

export async function listSavedProviders(userId: string) {
  const rows = await db.savedServiceProvider.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { providerId: true, createdAt: true },
    take: 500,
  });
  const publicProviders = await publicMarketplaceProvidersById(rows.map(({ providerId }) => providerId));
  return {
    items: rows.map(({ providerId, createdAt }) => {
      const provider = publicProviders.get(providerId) ?? null;
      return { providerId, savedAt: createdAt.toISOString(), available: provider !== null, provider };
    }),
  };
}

export async function saveProvider(userId: string, providerId: string) {
  if (!isUuid(providerId)) throw notFound();
  const listed = await publicMarketplaceProvidersById([providerId]);
  if (!listed.has(providerId)) throw notFound();
  try {
    const saved = await db.savedServiceProvider.upsert({
      where: { userId_providerId: { userId, providerId } },
      create: { userId, providerId },
      update: {},
      select: { createdAt: true },
    });
    return { providerId, saved: true, savedAt: saved.createdAt.toISOString() };
  } catch (error) {
    // Two concurrent saves: the unique (userId, providerId) index keeps one row; both succeed.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.savedServiceProvider.findUniqueOrThrow({ where: { userId_providerId: { userId, providerId } }, select: { createdAt: true } });
      return { providerId, saved: true, savedAt: existing.createdAt.toISOString() };
    }
    throw error;
  }
}

/** Idempotent: removing something that isn't saved (or doesn't exist) still succeeds. */
export async function unsaveProvider(userId: string, providerId: string) {
  if (isUuid(providerId)) await db.savedServiceProvider.deleteMany({ where: { userId, providerId } });
  return { providerId, saved: false };
}
