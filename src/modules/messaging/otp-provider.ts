import { ArkeselClient, type OtpVerifyResult } from "./arkesel-client";
import { readArkeselConfig } from "./config";

/**
 * The SMS one-time-code authority used by sign-in (`src/modules/identity/otp.ts`). Arkesel creates,
 * texts, expires and checks the code; NesAfric never sees it before the person types it. NesAfric
 * still owns everything around it: rate limits, attempt limits, single use and account state.
 *
 * Tests replace `getSmsOtpProvider` with a fake; nothing in the test suite talks to Arkesel.
 */
export interface SmsOtpProvider {
  readonly configured: boolean;
  readonly expiryMinutes: number;
  generate(numberE164: string, message: string): Promise<void>;
  verify(numberE164: string, code: string): Promise<OtpVerifyResult>;
}

export function getSmsOtpProvider(): SmsOtpProvider {
  const status = readArkeselConfig();
  const client = new ArkeselClient();
  return {
    configured: status.ok,
    expiryMinutes: status.ok ? status.config.otpExpiryMinutes : 5,
    generate: async (numberE164, message) => {
      await client.generateOtp({ numberE164, message });
    },
    verify: (numberE164, code) => client.verifyOtp({ numberE164, code }),
  };
}
