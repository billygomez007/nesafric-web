import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";

function membership(...keys: string[]) {
  return [
    {
      role: {
        permissions: keys.map((key) => ({
          permission: { key },
        })),
      },
    },
  ];
}

describe("recurring-charge RBAC policy", () => {
  it("allows recurring-charge reads to a member with lease.read", () => {
    const roles = membership(PERMISSIONS.leaseRead);

    expect(membershipHasPermission(roles, PERMISSIONS.leaseRead)).toBe(true);
  });

  it("does not allow recurring-charge writes with lease.read alone", () => {
    const roles = membership(PERMISSIONS.leaseRead);

    expect(membershipHasPermission(roles, PERMISSIONS.leaseUpdate)).toBe(false);
  });

  it("allows recurring-charge writes to a member with lease.update", () => {
    const roles = membership(PERMISSIONS.leaseRead, PERMISSIONS.leaseUpdate);

    expect(membershipHasPermission(roles, PERMISSIONS.leaseUpdate)).toBe(true);
  });

  it("does not infer recurring-charge permissions from unrelated permissions", () => {
    const roles = membership(PERMISSIONS.propertyRead, PERMISSIONS.paymentRead);

    expect(membershipHasPermission(roles, PERMISSIONS.leaseRead)).toBe(false);

    expect(membershipHasPermission(roles, PERMISSIONS.leaseUpdate)).toBe(false);
  });
});
