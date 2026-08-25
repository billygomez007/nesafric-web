import { describe, expect, it } from "vitest";
import { membershipHasPermission } from "@/platform/authorization/policy";

describe("permission policy", () => {
  const manager = [{ role: { permissions: [{ permission: { key: "property.read" } }, { permission: { key: "property.create" } }] } }];

  it("allows a granted permission", () => {
    expect(membershipHasPermission(manager, "property.create")).toBe(true);
  });

  it("does not grant permissions by role name or frontend state", () => {
    expect(membershipHasPermission(manager, "organisation.manage_members")).toBe(false);
  });
});
