import { describe, expect, it } from "vitest";
import {
  canTransitionAccount,
  canTransitionVerification,
  HOMEPAGE_COMPANY_TYPES,
  homepageIneligibilityReason,
  isHomepageEligible,
  professionalLifecycleActions,
  verificationAuditAction,
  verificationReasonRequired,
} from "@/modules/marketplace-professionals/admin-lifecycle";

const ALL = { canVerify: true, canManageHomepage: true };
const company = (overrides: Record<string, unknown> = {}) => ({
  type: "REAL_ESTATE_COMPANY",
  status: "ACTIVE",
  verificationStatus: "UNVERIFIED",
  archivedAt: null,
  ...overrides,
});
const labels = (overrides: Record<string, unknown>, options: { onHomepage?: boolean } = {}, permissions = ALL) =>
  professionalLifecycleActions(company(overrides), permissions, options).map((action) => action.label);

describe("verification transitions", () => {
  it("lets an admin decide directly on UNVERIFIED and PENDING profiles", () => {
    for (const from of ["UNVERIFIED", "PENDING"] as const) {
      expect(canTransitionVerification(from, "VERIFIED")).toBe(true);
      expect(canTransitionVerification(from, "REJECTED")).toBe(true);
    }
  });

  it("supports suspension, reinstatement and reversing a rejection", () => {
    expect(canTransitionVerification("VERIFIED", "SUSPENDED")).toBe(true);
    expect(canTransitionVerification("SUSPENDED", "VERIFIED")).toBe(true);
    expect(canTransitionVerification("REJECTED", "VERIFIED")).toBe(true);
  });

  it("refuses no-op and nonsensical transitions", () => {
    expect(canTransitionVerification("VERIFIED", "VERIFIED")).toBe(false);
    expect(canTransitionVerification("VERIFIED", "REJECTED")).toBe(false);
    expect(canTransitionVerification("UNVERIFIED", "SUSPENDED")).toBe(false);
  });

  it("requires a reason for rejection and suspension only", () => {
    expect(verificationReasonRequired("REJECTED")).toBe(true);
    expect(verificationReasonRequired("SUSPENDED")).toBe(true);
    expect(verificationReasonRequired("VERIFIED")).toBe(false);
  });

  it("names audit actions by decision", () => {
    expect(verificationAuditAction("UNVERIFIED", "VERIFIED")).toBe("marketplace_professional.verified");
    expect(verificationAuditAction("PENDING", "REJECTED")).toBe("marketplace_professional.verification_rejected");
    expect(verificationAuditAction("VERIFIED", "SUSPENDED")).toBe("marketplace_professional.verification_suspended");
    expect(verificationAuditAction("SUSPENDED", "VERIFIED")).toBe("marketplace_professional.verification_reinstated");
  });
});

describe("account transitions", () => {
  it("toggles ACTIVE and SUSPENDED and protects ARCHIVED", () => {
    expect(canTransitionAccount("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionAccount("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionAccount("ARCHIVED", "ACTIVE")).toBe(false);
    expect(canTransitionAccount("ACTIVE", "ACTIVE")).toBe(false);
  });
});

describe("homepage eligibility", () => {
  it("accepts only ACTIVE + VERIFIED + non-archived companies", () => {
    expect(isHomepageEligible(company({ verificationStatus: "VERIFIED" }))).toBe(true);
    for (const verificationStatus of ["UNVERIFIED", "PENDING", "REJECTED", "SUSPENDED"]) {
      expect(isHomepageEligible(company({ verificationStatus }))).toBe(false);
    }
    expect(isHomepageEligible(company({ verificationStatus: "VERIFIED", status: "SUSPENDED" }))).toBe(false);
    expect(isHomepageEligible(company({ verificationStatus: "VERIFIED", archivedAt: new Date() }))).toBe(false);
  });

  it("rejects verified INDIVIDUAL_AGENT, BROKER and OTHER", () => {
    expect(HOMEPAGE_COMPANY_TYPES).toEqual(["BROKERAGE", "REAL_ESTATE_COMPANY", "DEVELOPER", "PROPERTY_MARKETING_COMPANY"]);
    for (const type of ["INDIVIDUAL_AGENT", "BROKER", "OTHER"]) {
      expect(isHomepageEligible(company({ type, verificationStatus: "VERIFIED" }))).toBe(false);
      expect(homepageIneligibilityReason(company({ type, verificationStatus: "VERIFIED" }))).toMatch(/Only companies/);
    }
  });
});

describe("context-aware actions", () => {
  it("UNVERIFIED + ACTIVE: verify, reject, suspend account", () => {
    expect(labels({ verificationStatus: "UNVERIFIED" })).toEqual(["Verify", "Reject", "Suspend account"]);
  });

  it("PENDING: verify, reject, suspend account", () => {
    expect(labels({ verificationStatus: "PENDING" })).toEqual(["Verify", "Reject", "Suspend account"]);
  });

  it("VERIFIED + ACTIVE company: suspend verification, add to homepage, suspend account", () => {
    expect(labels({ verificationStatus: "VERIFIED" })).toEqual(["Suspend verification", "Add to homepage", "Suspend account"]);
    expect(labels({ verificationStatus: "VERIFIED" }, { onHomepage: true })).not.toContain("Add to homepage");
    expect(labels({ verificationStatus: "VERIFIED", type: "INDIVIDUAL_AGENT" })).not.toContain("Add to homepage");
  });

  it("VERIFIED + SUSPENDED account: reactivate account and suspend verification, never add to homepage", () => {
    expect(labels({ verificationStatus: "VERIFIED", status: "SUSPENDED" })).toEqual(["Suspend verification", "Reactivate account"]);
  });

  it("verification SUSPENDED: reinstate verification", () => {
    expect(labels({ verificationStatus: "SUSPENDED" })).toContain("Reinstate verification");
  });

  it("REJECTED: explicit reversal", () => {
    expect(labels({ verificationStatus: "REJECTED" })).toContain("Reverse and verify");
  });

  it("ARCHIVED: no actions", () => {
    expect(labels({ verificationStatus: "VERIFIED", status: "ARCHIVED", archivedAt: new Date() })).toEqual([]);
    expect(labels({ verificationStatus: "VERIFIED", archivedAt: new Date() })).toEqual([]);
  });

  it("hides actions the role cannot perform", () => {
    expect(labels({ verificationStatus: "UNVERIFIED" }, {}, { canVerify: false, canManageHomepage: true })).toEqual([]);
    expect(labels({ verificationStatus: "VERIFIED" }, {}, { canVerify: false, canManageHomepage: true })).toEqual(["Add to homepage"]);
    expect(labels({ verificationStatus: "VERIFIED" }, {}, { canVerify: true, canManageHomepage: false })).not.toContain("Add to homepage");
  });
});
