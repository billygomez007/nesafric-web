import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUnique,
  findFirst,
  enqueueEmail,
  sendSms,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  enqueueEmail: vi.fn(),
  sendSms: vi.fn(),
}));

vi.mock("@/platform/database/client", () => ({
  db: {
    tenantOrganisation: {
      findUnique,
    },
    lease: {
      findFirst,
    },
  },
}));

vi.mock("@/modules/account-emails/service", () => ({
  enqueueTenantAccessInvitationEmail: enqueueEmail,
}));

vi.mock("@/modules/messaging/sms", () => ({
  sendTransactionalSms: sendSms,
}));

import { deliverTenantAccessInvitation } from "@/modules/tenants/access-delivery";

const input = {
  tenantOrganisationId: "tenant-organisation-1",
  invitationId: "invitation-1",
  expiresAt: new Date("2026-10-02T12:00:00.000Z"),
  code: "NT-ABCDE-FGHJK-LMNPQ-RSTUV",
};

function relationship(overrides: {
  email?: string | null;
  phone?: string | null;
} = {}) {
  return {
    email: overrides.email === undefined ? "tenant@example.test" : overrides.email,
    phone: overrides.phone === undefined ? "+233241234567" : overrides.phone,
    tenant: {
      legalName: "Ama Tenant",
    },
    organisation: {
      name: "Golden Coast Properties",
    },
  };
}

describe("tenant access invitation delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    enqueueEmail.mockResolvedValue(undefined);
    sendSms.mockResolvedValue({
      status: "SENT",
      providerReferences: ["test-sms"],
    });
  });

  it("sends the transactional access code by SMS when a phone number is present", async () => {
    findUnique.mockResolvedValue(relationship());

    const result = await deliverTenantAccessInvitation(input);

    expect(enqueueEmail).toHaveBeenCalledOnce();
    expect(sendSms).toHaveBeenCalledOnce();
    expect(sendSms).toHaveBeenCalledWith({
      to: "+233241234567",
      message: expect.stringContaining(input.code),
    });
    expect(result).toEqual({
      email: "QUEUED",
      sms: "SENT",
    });
  });

  it("delivers a phone-only tenant invitation by SMS", async () => {
    findUnique.mockResolvedValue(
      relationship({
        email: null,
        phone: "+233241234567",
      }),
    );

    const result = await deliverTenantAccessInvitation(input);

    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledOnce();
    expect(sendSms).toHaveBeenCalledWith({
      to: "+233241234567",
      message: expect.stringContaining(input.code),
    });
    expect(result).toEqual({
      email: "SKIPPED",
      sms: "SENT",
    });
  });

  it("skips SMS when the tenant relationship has no phone number", async () => {
    findUnique.mockResolvedValue(
      relationship({
        phone: null,
      }),
    );

    const result = await deliverTenantAccessInvitation(input);

    expect(enqueueEmail).toHaveBeenCalledOnce();
    expect(sendSms).not.toHaveBeenCalled();
    expect(result).toEqual({
      email: "QUEUED",
      sms: "SKIPPED",
    });
  });
});
