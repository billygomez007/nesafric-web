import { describe, expect, it } from "vitest";
import { activePropertyScope } from "@/modules/assets/repository";

describe("organisation-scoped property access", () => {
  it("always includes the active organisation when retrieving a property by ID", () => {
    const scope = activePropertyScope("organisation-a", "property-owned-by-b");
    expect(scope).toEqual({ organisationId: "organisation-a", id: "property-owned-by-b", archivedAt: null });
  });

  it("cannot form a property lookup without an organisation scope", () => {
    expect(activePropertyScope("organisation-a")).toMatchObject({ organisationId: "organisation-a", archivedAt: null });
  });
});
