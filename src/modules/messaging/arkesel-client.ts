import { randomUUID } from "crypto";

import { maskPhone } from "@/platform/identity/phone";
import { ARKESEL_BASE_URL, requireArkeselConfig, type ArkeselConfig } from "./config";
import { MessagingError, type MessagingErrorCode } from "./errors";

/**
 * Typed, server-only client for Arkesel's documented REST API (API spec v2.4.0):
 *
 *   POST /api/v2/sms/send   { sender, message, recipients[] }                → { status, data[{recipient,id}] }
 *   POST /api/otp/generate  { expiry, length, medium, message, number, sender_id, type } → { code: "1000", … }
 *   POST /api/otp/verify    { code, number }                                 → { code: "1100", … }
 *
 * Auth: `api-key` header. Numbers go out as international digits without "+" (`233241234567`).
 * Every call logs one structured line (correlation id, operation, masked number, provider code,
 * outcome, duration) and nothing else: never the key, a code, a message body or a raw response.
 */
export type ArkeselLogEntry = {
  event: "messaging.arkesel";
  correlationId: string;
  operation: "sms.send" | "otp.generate" | "otp.verify";
  recipient: string;
  recipients?: number;
  ok: boolean;
  httpStatus?: number;
  providerCode?: string;
  errorCode?: MessagingErrorCode | "OTP_INVALID" | "OTP_EXPIRED";
  providerMessage?: string;
  durationMs: number;
};

export type ArkeselClientOptions = {
  config?: ArkeselConfig;
  fetchImpl?: typeof fetch;
  log?: (entry: ArkeselLogEntry) => void;
  timeoutMs?: number;
  now?: () => number;
};

export type OtpVerifyResult =
  | { ok: true; provider: "arkesel"; providerCode: string }
  | { ok: false; provider: "arkesel"; reason: "invalid" | "expired"; providerCode: string };

const defaultLog = (entry: ArkeselLogEntry) => console.info(JSON.stringify(entry));

const toProviderNumber = (e164: string) => {
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) throw new MessagingError("INVALID_PHONE", "Phone number must be in E.164 form.");
  return e164.slice(1);
};

/** Provider free text can echo input (codes, numbers): strip long digit runs and cap length. */
const redact = (message: unknown) =>
  typeof message === "string" ? message.replace(/\d{4,}/g, "[redacted]").slice(0, 160) : undefined;

const OTP_GENERATE_ERRORS: Record<string, MessagingErrorCode> = {
  "1001": "CONFIGURATION",
  "1002": "CONFIGURATION",
  "1003": "SENDER_ID",
  "1004": "CONFIGURATION",
  "1005": "INVALID_PHONE",
  "1006": "INVALID_PHONE",
  "1007": "INSUFFICIENT_BALANCE",
  "1008": "INSUFFICIENT_BALANCE",
  "1009": "CONFIGURATION",
  "1011": "PROVIDER_UNAVAILABLE",
};

const OTP_VERIFY_ERRORS: Record<string, MessagingErrorCode> = {
  "1101": "CONFIGURATION",
  "1102": "INVALID_PHONE",
  "1103": "INVALID_PHONE",
  "1106": "PROVIDER_UNAVAILABLE",
};

const SAFE_MESSAGES: Record<MessagingErrorCode, string> = {
  CONFIGURATION: "SMS provider rejected the request configuration.",
  SENDER_ID: "SMS provider rejected the sender ID.",
  INSUFFICIENT_BALANCE: "SMS provider account has insufficient balance.",
  INVALID_PHONE: "SMS provider rejected the phone number.",
  RATE_LIMITED: "SMS provider rate limit reached.",
  PROVIDER_UNAVAILABLE: "SMS provider is unavailable.",
  MALFORMED_RESPONSE: "SMS provider returned an unexpected response.",
};

function statusError(status: number): MessagingErrorCode {
  if (status === 401 || status === 403) return "CONFIGURATION";
  if (status === 402) return "INSUFFICIENT_BALANCE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "CONFIGURATION";
}

type Payload = { code?: unknown; status?: unknown; message?: unknown; data?: unknown } | null;

export class ArkeselClient {
  private readonly fetchImpl: typeof fetch;
  private readonly log: (entry: ArkeselLogEntry) => void;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly explicitConfig?: ArkeselConfig;

  constructor(options: ArkeselClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.log = options.log ?? defaultLog;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.now = options.now ?? Date.now;
    this.explicitConfig = options.config;
  }

  /** Read at call time so configuration changes (and tests) are honoured; fails closed. */
  private get config() {
    return this.explicitConfig ?? requireArkeselConfig();
  }

  private async post(path: string, body: Record<string, unknown>, apiKey: string) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${ARKESEL_BASE_URL}${path}`, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MessagingError("PROVIDER_UNAVAILABLE", timedOut ? "SMS provider timed out." : "SMS provider could not be reached.", { provider: "arkesel", retryable: true });
    }
    const payload = (await response.json().catch(() => null)) as Payload;
    return { response, payload, providerCode: payload ? String(payload.code ?? payload.status ?? "") || undefined : undefined };
  }

  private fail(code: MessagingErrorCode, httpStatus: number | undefined, providerCode?: string) {
    return new MessagingError(code, SAFE_MESSAGES[code], { provider: "arkesel", providerCode, httpStatus, retryable: code === "PROVIDER_UNAVAILABLE" || code === "RATE_LIMITED" });
  }

  private async observe<T>(operation: ArkeselLogEntry["operation"], recipient: string, recipients: number | undefined, work: (entry: Partial<ArkeselLogEntry>) => Promise<T>): Promise<T> {
    const started = this.now();
    const entry: Partial<ArkeselLogEntry> = {};
    const base = { event: "messaging.arkesel" as const, correlationId: randomUUID(), operation, recipient, ...(recipients && recipients > 1 ? { recipients } : {}) };
    try {
      const result = await work(entry);
      this.log({ ...base, ok: entry.ok ?? true, ...entry, durationMs: this.now() - started } as ArkeselLogEntry);
      return result;
    } catch (error) {
      const messagingError = error instanceof MessagingError ? error : null;
      this.log({
        ...base,
        ...entry,
        ok: false,
        errorCode: messagingError?.code ?? "PROVIDER_UNAVAILABLE",
        providerCode: messagingError?.details.providerCode ?? entry.providerCode,
        httpStatus: messagingError?.details.httpStatus ?? entry.httpStatus,
        durationMs: this.now() - started,
      } as ArkeselLogEntry);
      throw error;
    }
  }

  /** Transactional SMS. `sandbox` sends through Arkesel's unbilled test path (never delivered). */
  async sendSms(input: { recipientsE164: string[]; message: string; sandbox?: boolean }): Promise<{ messages: Array<{ recipientE164: string; providerId: string }> }> {
    const config = this.config;
    const numbers = input.recipientsE164.map(toProviderNumber);
    return this.observe("sms.send", input.recipientsE164.length === 1 ? maskPhone(input.recipientsE164[0]) : "multiple", numbers.length, async (entry) => {
      const { response, payload } = await this.post(
        "/api/v2/sms/send",
        { sender: config.senderId, message: input.message, recipients: numbers, ...(input.sandbox ? { sandbox: true } : {}) },
        config.apiKey,
      );
      entry.httpStatus = response.status;
      entry.providerMessage = redact(payload?.message);
      if (!response.ok || payload?.status !== "success") {
        if (!payload && response.ok) throw this.fail("MALFORMED_RESPONSE", response.status);
        const code = response.ok ? "CONFIGURATION" : statusError(response.status);
        throw this.fail(response.status === 422 && /sender/i.test(String(payload?.message ?? "")) ? "SENDER_ID" : code, response.status);
      }
      const data = Array.isArray(payload.data) ? payload.data : [];
      const messages = data.flatMap((item: { recipient?: unknown; id?: unknown }) =>
        typeof item?.recipient === "string" && typeof item.id === "string" ? [{ recipientE164: `+${item.recipient.replace(/^\+/, "")}`, providerId: item.id }] : [],
      );
      const accepted = new Set(messages.map((message) => message.recipientE164));
      if (!input.recipientsE164.some((number) => accepted.has(number))) throw this.fail("INVALID_PHONE", response.status);
      entry.ok = true;
      return { messages };
    });
  }

  /** Asks Arkesel to create and text a one-time code. NesAfric never sees the code. */
  async generateOtp(input: { numberE164: string; message: string }): Promise<{ providerCode: string }> {
    const config = this.config;
    if (!input.message.includes("%otp_code%")) throw new MessagingError("CONFIGURATION", "OTP message must contain %otp_code%.");
    const number = toProviderNumber(input.numberE164);
    return this.observe("otp.generate", maskPhone(input.numberE164), undefined, async (entry) => {
      const { response, payload, providerCode } = await this.post(
        "/api/otp/generate",
        { expiry: config.otpExpiryMinutes, length: config.otpLength, medium: "sms", message: input.message, number, sender_id: config.senderId, type: "numeric" },
        config.apiKey,
      );
      entry.httpStatus = response.status;
      entry.providerCode = providerCode;
      entry.providerMessage = redact(payload?.message);
      if (providerCode === "1000" && response.ok) {
        entry.ok = true;
        return { providerCode };
      }
      if (providerCode && OTP_GENERATE_ERRORS[providerCode]) throw this.fail(OTP_GENERATE_ERRORS[providerCode], response.status, providerCode);
      if (!payload) throw this.fail(response.ok ? "MALFORMED_RESPONSE" : statusError(response.status), response.status);
      throw this.fail(response.ok ? "MALFORMED_RESPONSE" : statusError(response.status), response.status, providerCode);
    });
  }

  /** Checks a code with Arkesel. Wrong and expired codes are results; everything else throws. */
  async verifyOtp(input: { numberE164: string; code: string }): Promise<OtpVerifyResult> {
    const config = this.config;
    const number = toProviderNumber(input.numberE164);
    return this.observe("otp.verify", maskPhone(input.numberE164), undefined, async (entry) => {
      const { response, payload, providerCode } = await this.post("/api/otp/verify", { code: input.code, number }, config.apiKey);
      entry.httpStatus = response.status;
      entry.providerCode = providerCode;
      entry.providerMessage = redact(payload?.message);
      if (providerCode === "1100" && response.ok) {
        entry.ok = true;
        return { ok: true as const, provider: "arkesel" as const, providerCode };
      }
      if (providerCode === "1104" || providerCode === "1105") {
        const reason = providerCode === "1105" ? ("expired" as const) : ("invalid" as const);
        entry.ok = false;
        entry.errorCode = reason === "expired" ? "OTP_EXPIRED" : "OTP_INVALID";
        return { ok: false as const, provider: "arkesel" as const, reason, providerCode };
      }
      if (providerCode && OTP_VERIFY_ERRORS[providerCode]) throw this.fail(OTP_VERIFY_ERRORS[providerCode], response.status, providerCode);
      throw this.fail(response.ok ? "MALFORMED_RESPONSE" : statusError(response.status), response.status, providerCode);
    });
  }
}
