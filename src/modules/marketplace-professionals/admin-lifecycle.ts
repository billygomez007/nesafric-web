/**
 * Platform-admin lifecycle rules for a `MarketplaceProfessional`. Pure data and functions only —
 * no database or server imports — so the API services (which enforce these rules) and the
 * platform-admin UI (which only offers the actions these rules allow) share one definition.
 *
 * Two separate concerns, never mixed:
 * - verification status (`MarketplaceVerificationStatus`): the public trust decision;
 * - account status (`MarketplaceProfessionalStatus`): whether the profile may operate at all.
 */

export type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type ProfessionalType =
  | "INDIVIDUAL_AGENT"
  | "BROKER"
  | "BROKERAGE"
  | "REAL_ESTATE_COMPANY"
  | "DEVELOPER"
  | "PROPERTY_MARKETING_COMPANY"
  | "OTHER";

/** Only companies may appear in the public homepage company rail. INDIVIDUAL_AGENT, BROKER and
 * OTHER are deliberately excluded, even when verified. */
export const HOMEPAGE_COMPANY_TYPES = [
  "BROKERAGE",
  "REAL_ESTATE_COMPANY",
  "DEVELOPER",
  "PROPERTY_MARKETING_COMPANY",
] as const satisfies readonly ProfessionalType[];

export const HOMEPAGE_INELIGIBLE_MESSAGE =
  "Only active, verified marketplace companies can be featured on the homepage.";

/** Every verification decision a platform admin may make, keyed by the current status. A status
 * absent from a list is not reachable from that status. */
export const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  UNVERIFIED: ["VERIFIED", "REJECTED"],
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: ["SUSPENDED"],
  SUSPENDED: ["VERIFIED"],
  // Reversing a rejection is an explicit admin decision.
  REJECTED: ["VERIFIED"],
};

/** Account lifecycle a platform admin may drive. ARCHIVED is protected: nothing leaves it here. */
export const ACCOUNT_TRANSITIONS: Record<AccountStatus, readonly AccountStatus[]> = {
  ACTIVE: ["SUSPENDED"],
  SUSPENDED: ["ACTIVE"],
  ARCHIVED: [],
};

export function canTransitionVerification(from: VerificationStatus, to: VerificationStatus) {
  return VERIFICATION_TRANSITIONS[from].includes(to);
}

export function canTransitionAccount(from: AccountStatus, to: AccountStatus) {
  return ACCOUNT_TRANSITIONS[from].includes(to);
}

/** A reason is mandatory for decisions that take trust away. */
export function verificationReasonRequired(to: VerificationStatus) {
  return to === "REJECTED" || to === "SUSPENDED";
}

export function accountReasonRequired(to: AccountStatus) {
  return to === "SUSPENDED";
}

export function verificationAuditAction(from: VerificationStatus, to: VerificationStatus) {
  if (to === "REJECTED") return "marketplace_professional.verification_rejected";
  if (to === "SUSPENDED") return "marketplace_professional.verification_suspended";
  if (from === "SUSPENDED") return "marketplace_professional.verification_reinstated";
  return "marketplace_professional.verified";
}

export function accountAuditAction(to: AccountStatus) {
  return to === "SUSPENDED"
    ? "marketplace_professional.account_suspended"
    : "marketplace_professional.account_reactivated";
}

type LifecycleSubject = {
  type: string;
  status: string;
  verificationStatus: string;
  archivedAt?: string | Date | null;
};

export function isArchived(subject: Pick<LifecycleSubject, "status" | "archivedAt">) {
  return subject.status === "ARCHIVED" || Boolean(subject.archivedAt);
}

export function isHomepageCompanyType(type: string) {
  return (HOMEPAGE_COMPANY_TYPES as readonly string[]).includes(type);
}

/** Why a professional cannot be featured on the homepage, or null when it can. Mirrors the
 * database filter used by the homepage media service and the public rail. */
export function homepageIneligibilityReason(subject: LifecycleSubject): string | null {
  if (!isHomepageCompanyType(subject.type)) return "Only companies can be featured, not individual agents, brokers or other types.";
  if (isArchived(subject)) return "Archived profiles cannot be featured.";
  if (subject.status !== "ACTIVE") return "The account is suspended. Reactivate it first.";
  if (subject.verificationStatus !== "VERIFIED") return "The company is not verified yet.";
  return null;
}

export function isHomepageEligible(subject: LifecycleSubject) {
  return homepageIneligibilityReason(subject) === null;
}

export type LifecycleActionKind =
  | "verify"
  | "reject"
  | "suspend_verification"
  | "reinstate_verification"
  | "suspend_account"
  | "reactivate_account"
  | "add_to_homepage";

export type LifecycleAction = {
  kind: LifecycleActionKind;
  label: string;
  tone: "primary" | "secondary" | "danger";
  /** The verification or account status this action moves to (none for homepage actions). */
  target?: VerificationStatus | AccountStatus;
  reasonRequired: boolean;
};

export type LifecyclePermissions = {
  canVerify: boolean;
  canManageHomepage: boolean;
};

/**
 * The actions that make sense for a professional in its current state, in display order. The UI
 * renders exactly these; the API enforces the same rules independently.
 */
export function professionalLifecycleActions(
  subject: LifecycleSubject,
  permissions: LifecyclePermissions,
  options: { onHomepage?: boolean } = {},
): LifecycleAction[] {
  if (isArchived(subject)) return [];
  const actions: LifecycleAction[] = [];
  const verification = subject.verificationStatus as VerificationStatus;
  const account = subject.status as AccountStatus;

  if (permissions.canVerify) {
    for (const target of VERIFICATION_TRANSITIONS[verification] ?? []) {
      if (target === "VERIFIED") {
        const label =
          verification === "SUSPENDED" ? "Reinstate verification"
          : verification === "REJECTED" ? "Reverse and verify"
          : "Verify";
        actions.push({ kind: verification === "SUSPENDED" ? "reinstate_verification" : "verify", label, tone: "primary", target, reasonRequired: false });
      } else if (target === "REJECTED") {
        actions.push({ kind: "reject", label: "Reject", tone: "danger", target, reasonRequired: true });
      } else if (target === "SUSPENDED") {
        actions.push({ kind: "suspend_verification", label: "Suspend verification", tone: "danger", target, reasonRequired: true });
      }
    }
  }

  if (permissions.canManageHomepage && !options.onHomepage && isHomepageEligible(subject)) {
    actions.push({ kind: "add_to_homepage", label: "Add to homepage", tone: "secondary", reasonRequired: false });
  }

  if (permissions.canVerify) {
    if (canTransitionAccount(account, "SUSPENDED")) {
      actions.push({ kind: "suspend_account", label: "Suspend account", tone: "danger", target: "SUSPENDED", reasonRequired: true });
    }
    if (canTransitionAccount(account, "ACTIVE")) {
      actions.push({ kind: "reactivate_account", label: "Reactivate account", tone: "primary", target: "ACTIVE", reasonRequired: false });
    }
  }

  return actions;
}
