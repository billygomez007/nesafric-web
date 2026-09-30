import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("service provider workspace shell", () => {
  const shell = source("src/components/provider-workspace-shell.tsx");
  const detail = source("src/components/provider-detail.tsx");
  const workspace = source("src/components/provider-workspace-page.tsx");

  it("uses service provider as the active first-class workspace", () => {
    expect(shell).toContain('kind: "service_provider"');
    expect(shell).toContain("providerName");
    expect(shell).toContain("<WorkspaceSwitcher");
  });

  it("exposes only provider capabilities backed by the current implementation", () => {
    expect(shell).toContain('"Dashboard"');
    expect(shell).toContain('"Profile"');
    expect(shell).toContain('"Verification"');
    expect(shell).toContain('"Jobs"');
    expect(shell).toContain('"Availability"');

    expect(shell).not.toContain('"Requests"');
    expect(shell).not.toContain('"Quotations"');
    expect(shell).not.toContain('"Reviews"');
  });

  it("keeps every provider workspace scoped to the provider id", () => {
    expect(shell).toContain("const base = `/providers/${providerId}`");
  });

  it("gives profile, verification, jobs and availability distinct section modes", () => {
    expect(detail).toContain('"dashboard"');
    expect(detail).toContain('"profile"');
    expect(detail).toContain('"verification"');
    expect(detail).toContain('"jobs"');
    expect(detail).toContain('"availability"');

    expect(workspace).toContain("SECTION_COPY");
    expect(workspace).toContain("section={section}");
  });

  it("maps each provider route to the matching section", () => {
    const cases = [
      ["src/app/providers/[providerId]/page.tsx", 'section="dashboard"'],
      [
        "src/app/providers/[providerId]/profile/page.tsx",
        'section="profile"',
      ],
      [
        "src/app/providers/[providerId]/verification/page.tsx",
        'section="verification"',
      ],
      ["src/app/providers/[providerId]/jobs/page.tsx", 'section="jobs"'],
      [
        "src/app/providers/[providerId]/availability/page.tsx",
        'section="availability"',
      ],
    ] as const;

    for (const [file, contract] of cases) {
      expect(source(file)).toContain(contract);
    }
  });

  it("uses the authenticated provider response shape for the workspace label", () => {
    expect(workspace).toContain("result.provider.displayName");
    expect(workspace).toContain("x-organisation-id");
  });

  it("keeps responsive provider navigation", () => {
    expect(shell).toContain("lg:hidden");
    expect(shell).toContain("lg:flex");
    expect(shell).toContain("mobileOpen");
  });

  it("groups provider profile services by their authoritative parent category", () => {
    const settings = source("src/components/provider-marketplace-settings.tsx");

    const service = source("src/modules/providers/service.ts");

    expect(settings).toContain("groupMarketplaceCategoriesByParent");
    expect(settings).toContain("category.parent");
    expect(service).toContain("providerInclude");
    expect(service).toContain("parent:");
    expect(service).toContain("sortOrder: true");
    expect(settings).toContain("category.parent.sortOrder");
    expect(settings).toContain("group.categories.map");
    expect(settings).toContain("Public service categories");
    expect(settings).not.toContain(
      "{categories.map((category) => <label",
    );
  });

});
