/**
 * Platform-administration permissions (item 8). A small, closed set evaluated entirely in code —
 * deliberately not the DB-driven `Role`/`Permission`/`RolePermission` tables organisation RBAC
 * uses (`src/platform/authorization/`). The two systems share no plumbing, no tables, and no
 * concepts: an `OrganisationMember`'s roles say nothing whatsoever about platform access, and a
 * `PlatformPrincipal`'s role says nothing about any organisation's RBAC.
 */
export const PLATFORM_PERMISSIONS = {
  orgsRead: "orgs.read",
  usersRead: "users.read",
  marketplaceRead: "marketplace.read",
  subscriptionsRead: "subscriptions.read",
  paymentsRead: "payments.read",
  listingsRead: "listings.read",
  listingsVerify: "listings.verify",
  maintenanceRead: "maintenance.read",
  communicationsRead: "communications.read",
  aiOperationsRead: "ai_operations.read",
  orgsManage: "orgs.manage",
  plansManage: "plans.manage",
  entitlementsOverride: "entitlements.override",
  flagsManage: "flags.manage",
  supportSessionCreate: "support_session.create",
  analyticsRead: "analytics.read",
  auditRead: "platform_audit.read",
  jobsManage: "jobs.manage",
  /// Phase 21A: reviewing (verifying/rejecting/suspending) a Marketplace professional profile's
  /// public trust status. Deliberately its own permission rather than reusing `entitlementsOverride`
  /// — a distinct platform capability, not a commercial-entitlement one.
  marketplaceVerify: "marketplace.verify",
  /// Phase 21B (item 21): reviewing/scheduling/pausing NesAfric campaign & promotion placements
  /// (homepage announcements and marketplace banners). Its own permission — distinct from
  /// `marketplaceVerify` (trust/verification) and `plansManage` (commercial plans).
  campaignReview: "campaign.review",
  /// Curating public homepage media: trusted-company logo rail ordering/visibility
  /// and other homepage presentation controls. Kept separate from campaign.review
  /// so advertising operations and homepage editorial control can diverge safely.
  homepageMediaManage: "homepage_media.manage",
  /// Top Ads: pinning already-published marketplace listings to the top of the public property
  /// marketplace. A paid-placement decision, so SUPER_ADMIN only (not granted to any other role).
  topAdsManage: "top_ads.manage",
  /// Phase 23: reviewing mandatory identity/business/credential evidence (Ghana Card etc.) for a
  /// Property Service Professional and setting `ServiceProvider.identityVerifiedAt` /
  /// `businessVerifiedAt` / `skillVerifiedAt`. Deliberately separate from `marketplaceVerify`
  /// (which governs `MarketplaceProfessional` trust, a different domain) and from the org-scoped
  /// `provider.verify` permission in `src/platform/authorization/permissions.ts` (a landlord's own
  /// private-directory trust check, which cannot verify a provider with no landlord at all).
  providerIdentityReview: "provider_identity.review",
  /// Reviewing a landlord's claim to own or manage a property registered without evidence
  /// (for example over WhatsApp).
  portfolioVerify: "portfolio.verify",
  /// Assigning or moving a WhatsApp phone number ID to an organisation. Every number sends with one
  /// Meta system-user token, so this decides who can send as which number: SUPER_ADMIN only.
  whatsappNumbersManage: "whatsapp_numbers.manage",
  /// Shared geography: viewing areas, localities, aliases, imports and unresolved locations.
  geographyRead: "geography.read",
  /// Resolving unresolved or ambiguous locations and adding aliases. Separate from business
  /// approval and listing moderation: fixing where something is approves nothing.
  geographyReview: "geography.review",
  /// Running and reviewing geographic imports, deactivating records and merging duplicates.
  /// Reference data for every location, so SUPER_ADMIN only.
  geographyManage: "geography.manage",
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];
export type PlatformRoleValue = "SUPER_ADMIN" | "BILLING_ADMIN" | "SUPPORT_AGENT" | "READ_ONLY";

const ALL_PERMISSIONS = Object.values(PLATFORM_PERMISSIONS);

const ROLE_PERMISSIONS: Record<PlatformRoleValue, readonly PlatformPermission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  BILLING_ADMIN: [PLATFORM_PERMISSIONS.orgsRead, PLATFORM_PERMISSIONS.usersRead, PLATFORM_PERMISSIONS.subscriptionsRead, PLATFORM_PERMISSIONS.paymentsRead, PLATFORM_PERMISSIONS.orgsManage, PLATFORM_PERMISSIONS.plansManage, PLATFORM_PERMISSIONS.entitlementsOverride, PLATFORM_PERMISSIONS.analyticsRead, PLATFORM_PERMISSIONS.auditRead, PLATFORM_PERMISSIONS.campaignReview],
  SUPPORT_AGENT: [PLATFORM_PERMISSIONS.orgsRead, PLATFORM_PERMISSIONS.usersRead, PLATFORM_PERMISSIONS.marketplaceRead, PLATFORM_PERMISSIONS.listingsRead, PLATFORM_PERMISSIONS.supportSessionCreate, PLATFORM_PERMISSIONS.auditRead, PLATFORM_PERMISSIONS.marketplaceVerify, PLATFORM_PERMISSIONS.providerIdentityReview, PLATFORM_PERMISSIONS.portfolioVerify, PLATFORM_PERMISSIONS.maintenanceRead, PLATFORM_PERMISSIONS.communicationsRead, PLATFORM_PERMISSIONS.aiOperationsRead, PLATFORM_PERMISSIONS.geographyRead, PLATFORM_PERMISSIONS.geographyReview],
  READ_ONLY: [PLATFORM_PERMISSIONS.orgsRead, PLATFORM_PERMISSIONS.usersRead, PLATFORM_PERMISSIONS.marketplaceRead, PLATFORM_PERMISSIONS.listingsRead, PLATFORM_PERMISSIONS.subscriptionsRead, PLATFORM_PERMISSIONS.paymentsRead, PLATFORM_PERMISSIONS.analyticsRead, PLATFORM_PERMISSIONS.auditRead, PLATFORM_PERMISSIONS.maintenanceRead, PLATFORM_PERMISSIONS.communicationsRead, PLATFORM_PERMISSIONS.aiOperationsRead, PLATFORM_PERMISSIONS.geographyRead],
};

export function platformRoleHasPermission(role: PlatformRoleValue, permission: PlatformPermission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
