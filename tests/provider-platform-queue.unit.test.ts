import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform service-provider queue", () => {
  const service = readFileSync(
    "src/modules/providers/service.ts",
    "utf8",
  );

  const adminUi = readFileSync(
    "src/components/platform-admin/service-providers-content.tsx",
    "utf8",
  );

  it("keeps new registrations in an Awaiting submission queue", () => {
    expect(service).toContain('"AWAITING_SUBMISSION"');
    expect(service).toContain('tab === "AWAITING_SUBMISSION"');
    expect(service).toContain(
      'verificationStatus: "UNVERIFIED" as const',
    );

    expect(adminUi).toContain(
      '{ value: "AWAITING_SUBMISSION", label: "Awaiting submission" }',
    );
  });

  it("keeps submitted verification separate from unsubmitted registrations", () => {
    expect(service).toContain('tab === "PENDING_VERIFICATION"');
    expect(service).toContain(
      'verificationStatus: "PENDING" as const',
    );
  });

  it("does not remove the all-provider queue", () => {
    expect(service).toContain('tab === "ALL"');
    expect(adminUi).toContain(
      '{ value: "ALL", label: "All" }',
    );
  });
});
