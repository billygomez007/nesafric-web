/**
 * In-memory stand-in for Arkesel's SMS one-time codes, for `vi.mock("@/modules/messaging/otp-provider")`.
 * Import-free on purpose so it can be loaded from a mock factory. Nothing reaches a real SMS gateway.
 */
export const fakeSms = {
  configured: true,
  codes: new Map<string, string>(),
  sent: [] as string[],
};

export const fakeSmsOtpModule = {
  getSmsOtpProvider: () => ({
    configured: fakeSms.configured,
    expiryMinutes: 5,
    generate: async (numberE164: string) => {
      const code = String(Math.floor(100_000 + Math.random() * 899_999));
      fakeSms.codes.set(numberE164, code);
      fakeSms.sent.push(numberE164);
    },
    verify: async (numberE164: string, code: string) =>
      fakeSms.codes.get(numberE164) === code
        ? { ok: true as const, provider: "arkesel" as const, providerCode: "1100" }
        : { ok: false as const, provider: "arkesel" as const, reason: "invalid" as const, providerCode: "1104" },
  }),
};
