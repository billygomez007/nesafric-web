import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  smsMock,
  resolveClientIdentityMock,
  ipRateLimitKeyMock,
  markVerifiedMock,
} = vi.hoisted(() => ({
  prismaMock: {
    businessWhatsAppConfig: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    businessWhatsAppVerificationChallenge: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
  smsMock: {
    configured: true,
    expiryMinutes: 5,
    generate: vi.fn(),
    verify: vi.fn(),
  },
  resolveClientIdentityMock: vi.fn(),
  ipRateLimitKeyMock: vi.fn(),
  markVerifiedMock: vi.fn(),
}));

vi.mock("@/platform/database/client", () => ({
  db: prismaMock,
}));

vi.mock("@/modules/messaging/otp-provider", () => ({
  getSmsOtpProvider: () => smsMock,
}));

vi.mock("@/platform/security/client-ip", () => ({
  resolveClientIdentity: resolveClientIdentityMock,
  ipRateLimitKey: ipRateLimitKeyMock,
}));

vi.mock("@/modules/business-whatsapp/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/business-whatsapp/service")>();

  return {
    ...actual,
    markBusinessWhatsAppVerified: markVerifiedMock,
  };
});

import {
  requestBusinessWhatsAppVerification,
  verifyBusinessWhatsApp,
} from "@/modules/business-whatsapp/verification";

const subject = {
  organisationId: "11111111-1111-4111-8111-111111111111",
} as const;

const config = {
  id: "22222222-2222-4222-8222-222222222222",
  organisationId: subject.organisationId,
  serviceProviderId: null,
  whatsappNumber: "+233241234567",
  whatsappVerified: false,
  whatsappVerifiedAt: null,
  whatsappOptIn: true,
  whatsappOptInAt: new Date("2026-09-30T12:00:00.000Z"),
  whatsappNotificationsEnabled: false,
  inquiryNotifications: true,
  viewingNotifications: true,
  leadNotifications: true,
  savedPropertyNotifications: true,
  bookingNotifications: true,
  serviceRequestNotifications: true,
  messageNotifications: true,
  reviewNotifications: true,
  accountActivityNotifications: true,
  createdAt: new Date("2026-09-30T12:00:00.000Z"),
  updatedAt: new Date("2026-09-30T12:00:00.000Z"),
};

const activeChallenge = {
  id: "33333333-3333-4333-8333-333333333333",
  businessWhatsAppConfigId: config.id,
  whatsappNumber: config.whatsappNumber,
  requesterHash: "requester-hash",
  expiresAt: new Date(Date.now() + 5 * 60_000),
  consumedAt: null,
  supersededAt: null,
  failedAttempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function wireTransaction() {
  prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
    if (typeof callback === "function") {
      return callback(prismaMock);
    }
    return callback;
  });
}

describe("business WhatsApp verification security", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    smsMock.configured = true;
    smsMock.expiryMinutes = 5;
    smsMock.generate.mockResolvedValue({ ok: true });
    smsMock.verify.mockResolvedValue({ ok: true });

    resolveClientIdentityMock.mockReturnValue({
      ip: "203.0.113.10",
    });
    ipRateLimitKeyMock.mockReturnValue("requester-hash");

    prismaMock.businessWhatsAppConfig.findFirst.mockResolvedValue(config);
    prismaMock.businessWhatsAppConfig.findUnique.mockResolvedValue(config);

    prismaMock.businessWhatsAppVerificationChallenge.count.mockResolvedValue(0);
    prismaMock.businessWhatsAppVerificationChallenge.findMany.mockResolvedValue([]);
    prismaMock.businessWhatsAppVerificationChallenge.findFirst.mockResolvedValue(null);
    prismaMock.businessWhatsAppVerificationChallenge.findUnique.mockResolvedValue(
      activeChallenge,
    );
    prismaMock.businessWhatsAppVerificationChallenge.create.mockResolvedValue(
      activeChallenge,
    );
    prismaMock.businessWhatsAppVerificationChallenge.update.mockResolvedValue(
      activeChallenge,
    );
    prismaMock.businessWhatsAppVerificationChallenge.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);

    markVerifiedMock.mockResolvedValue({
      ...config,
      whatsappVerified: true,
      whatsappVerifiedAt: new Date(),
      whatsappNotificationsEnabled: true,
    });

    wireTransaction();
  });

  it("sends verification only to the saved business WhatsApp number", async () => {
    const request = new Request("https://www.nesafric.com/api/test", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.10",
      },
    });

    await requestBusinessWhatsAppVerification(subject, request.headers);

    expect(smsMock.generate).toHaveBeenCalledTimes(1);
    expect(smsMock.generate.mock.calls[0]?.[0]).toBe(config.whatsappNumber);

    expect(
      prismaMock.businessWhatsAppVerificationChallenge.create,
    ).toHaveBeenCalledTimes(1);

    const createCall =
      prismaMock.businessWhatsAppVerificationChallenge.create.mock.calls[0]?.[0];

    expect(createCall.data.businessWhatsAppConfigId).toBe(config.id);
    expect(createCall.data.whatsappNumber).toBe(config.whatsappNumber);
    expect(createCall.data.requesterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createCall.data.requesterHash).not.toBe("203.0.113.10");
    expect(createCall.data.requesterHash).not.toBe("requester-hash");
  });

  it("does not leave a usable active challenge when SMS delivery fails", async () => {
    smsMock.generate.mockRejectedValueOnce(new Error("provider unavailable"));

    const request = new Request("https://www.nesafric.com/api/test", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.10",
      },
    });

    await expect(
      requestBusinessWhatsAppVerification(subject, request.headers),
    ).rejects.toBeDefined();

    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects an expired challenge without marking the business verified", async () => {
    prismaMock.businessWhatsAppVerificationChallenge.findUnique.mockResolvedValueOnce(
      {
        ...activeChallenge,
        expiresAt: new Date(Date.now() - 1_000),
      },
    );

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "123456",
      }),
    ).rejects.toBeDefined();

    expect(smsMock.verify).not.toHaveBeenCalled();
    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects a consumed challenge as single-use", async () => {
    prismaMock.businessWhatsAppVerificationChallenge.findUnique.mockResolvedValueOnce(
      {
        ...activeChallenge,
        consumedAt: new Date(),
      },
    );

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "123456",
      }),
    ).rejects.toBeDefined();

    expect(smsMock.verify).not.toHaveBeenCalled();
    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects a superseded challenge", async () => {
    prismaMock.businessWhatsAppVerificationChallenge.findUnique.mockResolvedValueOnce(
      {
        ...activeChallenge,
        supersededAt: new Date(),
      },
    );

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "123456",
      }),
    ).rejects.toBeDefined();

    expect(smsMock.verify).not.toHaveBeenCalled();
    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("rejects a challenge after the configured WhatsApp number changes", async () => {
    prismaMock.businessWhatsAppConfig.findFirst.mockResolvedValueOnce({
      ...config,
      whatsappNumber: "+233201112222",
    });

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "123456",
      }),
    ).rejects.toBeDefined();

    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("increments failed attempts for an invalid provider code", async () => {
    smsMock.verify.mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
    });

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "000000",
      }),
    ).rejects.toBeDefined();

    expect(
      prismaMock.businessWhatsAppVerificationChallenge.updateMany,
    ).toHaveBeenCalled();

    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("does not spend an OTP attempt when provider verification is unavailable", async () => {
    smsMock.verify.mockRejectedValueOnce(new Error("provider outage"));

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "123456",
      }),
    ).rejects.toBeDefined();

    const calls =
      prismaMock.businessWhatsAppVerificationChallenge.updateMany.mock.calls;

    const failedAttemptMutation = calls.find((call) => {
      const data = call?.[0]?.data;
      return Boolean(data?.failedAttempts);
    });

    expect(failedAttemptMutation).toBeUndefined();
    expect(markVerifiedMock).not.toHaveBeenCalled();
  });

  it("consumes a successful challenge and marks the business verified", async () => {
    const result = await verifyBusinessWhatsApp(subject, {
      challengeId: activeChallenge.id,
      code: "123456",
    });

    expect(smsMock.verify).toHaveBeenCalledWith(
      config.whatsappNumber,
      "123456",
    );

    expect(
      prismaMock.businessWhatsAppVerificationChallenge.updateMany,
    ).toHaveBeenCalled();

    expect(markVerifiedMock).toHaveBeenCalledWith(subject);
    expect(result).toBeDefined();
  });

  it("never marks verified when challenge consumption loses the race", async () => {
    smsMock.verify.mockResolvedValueOnce({ ok: true });

    prismaMock.businessWhatsAppVerificationChallenge.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      verifyBusinessWhatsApp(subject, {
        challengeId: activeChallenge.id,
        code: "123456",
      }),
    ).rejects.toBeDefined();

    expect(markVerifiedMock).not.toHaveBeenCalled();
  });
});
