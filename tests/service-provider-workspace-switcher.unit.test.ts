import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const switcher = fs.readFileSync(
  path.join(root, "src/components/workspace-switcher.tsx"),
  "utf8",
);

const workspaceService = fs.readFileSync(
  path.join(root, "src/modules/marketplace-professionals/service.ts"),
  "utf8",
);

describe("service provider web workspace switcher", () => {
  it("keeps all three workspace collections separate", () => {
    expect(workspaceService).toContain(
      "return { propertyOsOrganisations, marketplaceProfessionals, serviceProviders };",
    );

    expect(switcher).toContain("workspaces.propertyOsOrganisations.map");
    expect(switcher).toContain("workspaces.marketplaceProfessionals.map");
    expect(switcher).toContain("workspaces.serviceProviders.map");
  });

  it("supports service provider as a first-class current workspace", () => {
    expect(switcher).toContain(
      '"propertyos" | "marketplace" | "service_provider"',
    );
  });

  it("routes an owned service provider to its existing workspace", () => {
    expect(switcher).toContain("Service Provider workspaces");
    expect(switcher).not.toContain("Service Provider profiles");
    expect(switcher).toContain('href={`/providers/${provider.id}`}');
  });

  it("uses the existing registration flow when there is no provider workspace", () => {
    expect(switcher).toContain('href="/providers/new"');
    expect(switcher).toContain("+ Register a service provider");
  });

  it("shows provider verification state without exposing private review data", () => {
    expect(switcher).toContain("provider.verificationStatus");
    expect(switcher).toContain("Awaiting submission");
    expect(switcher).toContain("Verification pending");
    expect(switcher).toContain("More information required");
    expect(switcher).toContain("Verification rejected");
    expect(switcher).toContain("Suspended");

    expect(switcher).not.toContain("suspensionReason");
    expect(switcher).not.toContain("reviewNotes");
  });
});
