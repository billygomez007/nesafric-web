import { db } from "@/platform/database/client";
import { forbidden } from "@/platform/errors";
import type { MarketplaceMemberRole } from "@/platform/database/generated/client";

/**
 * A deliberately lightweight RBAC model for marketplace professional teams (item 2 + item 11) —
 * an ordered role enum rather than the full PropertyOS `Permission`/`Role`/`RolePermission`
 * tri-table, which is scoped to `Organisation` and not appropriate to duplicate for a completely
 * separate account family. OWNER > ADMIN > AGENT; a member below the required rank is forbidden,
 * exactly like `requirePermission` is for PropertyOS organisations.
 */
const RANK: Record<MarketplaceMemberRole, number> = { AGENT: 0, ADMIN: 1, OWNER: 2 };

export async function requireMarketplaceRole(userId: string, marketplaceProfessionalId: string, minRole: MarketplaceMemberRole) {
  const member = await db.marketplaceProfessionalMember.findUnique({
    where: { marketplaceProfessionalId_userId: { marketplaceProfessionalId, userId } },
  });
  if (!member || member.status !== "ACTIVE" || RANK[member.role] < RANK[minRole]) throw forbidden();
  return member;
}

/** Read access (item 11's "safe public projections" complement): any active member, any role. */
export async function requireMarketplaceMember(userId: string, marketplaceProfessionalId: string) {
  return requireMarketplaceRole(userId, marketplaceProfessionalId, "AGENT");
}
