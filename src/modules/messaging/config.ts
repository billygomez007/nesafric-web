import { MessagingError } from "./errors";

/**
 * Arkesel configuration, read from server-only environment variables. Never `NEXT_PUBLIC_` /
 * `EXPO_PUBLIC_`: the key must not reach a browser or the app. Missing or invalid values fail
 * closed — there is no default sender ID, because an unapproved sender is silently dropped by
 * networks and "Arkesel" is not ours to use.
 */
export const ARKESEL_BASE_URL = "https://sms.arkesel.com";

export type ArkeselConfig = {
  apiKey: string;
  senderId: string;
  otpExpiryMinutes: number;
  otpLength: 6;
};

type Env = Record<string, string | undefined>;

/** Arkesel sender IDs are 3–11 characters (letters, digits, spaces). */
const SENDER_ID = /^[A-Za-z0-9 ]{3,11}$/;

export function readArkeselConfig(env: Env = process.env): { ok: true; config: ArkeselConfig } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const apiKey = env.ARKESEL_API_KEY?.trim() ?? "";
  const senderId = env.ARKESEL_SENDER_ID?.trim() ?? "";
  if (!apiKey) problems.push("ARKESEL_API_KEY is not set.");
  if (!senderId) problems.push("ARKESEL_SENDER_ID is not set.");
  else if (!SENDER_ID.test(senderId)) problems.push("ARKESEL_SENDER_ID must be 3-11 letters, digits or spaces.");

  const expiryRaw = env.ARKESEL_OTP_EXPIRY_MINUTES?.trim();
  const otpExpiryMinutes = expiryRaw ? Number(expiryRaw) : 5;
  if (!Number.isInteger(otpExpiryMinutes) || otpExpiryMinutes < 1 || otpExpiryMinutes > 10) {
    problems.push("ARKESEL_OTP_EXPIRY_MINUTES must be a whole number from 1 to 10.");
  }
  // The web and mobile code fields and server validation are built for 6 digits.
  const lengthRaw = env.ARKESEL_OTP_LENGTH?.trim();
  if (lengthRaw && lengthRaw !== "6") problems.push("ARKESEL_OTP_LENGTH must be 6 (the only length NesAfric supports).");

  if (problems.length) return { ok: false, problems };
  return { ok: true, config: { apiKey, senderId, otpExpiryMinutes, otpLength: 6 } };
}

export function requireArkeselConfig(env: Env = process.env): ArkeselConfig {
  const result = readArkeselConfig(env);
  if (!result.ok) throw new MessagingError("CONFIGURATION", `Arkesel is not configured: ${result.problems.join(" ")}`);
  return result.config;
}

/** Secret-free readiness for health views. */
export function arkeselStatus(env: Env = process.env) {
  const result = readArkeselConfig(env);
  return result.ok ? { configured: true as const, problems: [] } : { configured: false as const, problems: result.problems };
}
