import { describe, expect, it, vi } from "vitest";

import { ArkeselClient, type ArkeselLogEntry } from "@/modules/messaging/arkesel-client";
import { ARKESEL_BASE_URL, readArkeselConfig, requireArkeselConfig, type ArkeselConfig } from "@/modules/messaging/config";
import { MessagingError } from "@/modules/messaging/errors";
import { MAX_TRANSACTIONAL_RECIPIENTS, sendTransactionalSms } from "@/modules/messaging/sms";

const KEY = "ak_live_secret_KEY_value_that_must_never_leak";
const CONFIG: ArkeselConfig = { apiKey: KEY, senderId: "NesAfric", otpExpiryMinutes: 5, otpLength: 6 };
const CODE = "482913";

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function harness(reply: Response | (() => Promise<Response>)) {
  const logs: ArkeselLogEntry[] = [];
  const fetchImpl = vi.fn(async () => (typeof reply === "function" ? reply() : reply));
  const client = new ArkeselClient({ config: CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch, log: (entry) => logs.push(entry) });
  const request = (index = 0) => {
    const [url, init] = fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
    return { url, init, body: JSON.parse(String(init.body)) };
  };
  return { client, fetchImpl, logs, request };
}

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as MessagingError;
  }
  throw new Error("expected a rejection");
}

const noSecrets = (value: unknown) => {
  const text = JSON.stringify(value) + String((value as Error)?.message ?? "");
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(CODE);
  expect(text).not.toContain("241234567");
};

describe("Arkesel configuration", () => {
  it("fails closed without an API key or a sender ID, naming only the variables", () => {
    for (const env of [{}, { ARKESEL_API_KEY: KEY }, { ARKESEL_SENDER_ID: "NesAfric" }]) {
      const result = readArkeselConfig(env);
      expect(result.ok).toBe(false);
      expect(() => requireArkeselConfig(env)).toThrow(MessagingError);
      noSecrets(result);
    }
    expect(readArkeselConfig({ ARKESEL_API_KEY: KEY, ARKESEL_SENDER_ID: "NesAfric" })).toEqual({ ok: true, config: CONFIG });
  });

  it("validates the sender ID, expiry and length — no silent defaults", () => {
    const base = { ARKESEL_API_KEY: KEY, ARKESEL_SENDER_ID: "NesAfric" };
    expect(readArkeselConfig({ ...base, ARKESEL_SENDER_ID: "NesAfric Properties Ltd" }).ok).toBe(false);
    expect(readArkeselConfig({ ...base, ARKESEL_SENDER_ID: "Ne" }).ok).toBe(false);
    expect(readArkeselConfig({ ...base, ARKESEL_OTP_EXPIRY_MINUTES: "30" }).ok).toBe(false);
    expect(readArkeselConfig({ ...base, ARKESEL_OTP_EXPIRY_MINUTES: "abc" }).ok).toBe(false);
    expect(readArkeselConfig({ ...base, ARKESEL_OTP_LENGTH: "4" }).ok).toBe(false);
    expect(readArkeselConfig({ ...base, ARKESEL_OTP_EXPIRY_MINUTES: "3", ARKESEL_OTP_LENGTH: "6" })).toEqual({ ok: true, config: { ...CONFIG, otpExpiryMinutes: 3 } });
  });

  it("a client with no configuration refuses before any network call", async () => {
    const fetchImpl = vi.fn();
    const previous = { key: process.env.ARKESEL_API_KEY, sender: process.env.ARKESEL_SENDER_ID };
    delete process.env.ARKESEL_API_KEY;
    delete process.env.ARKESEL_SENDER_ID;
    const client = new ArkeselClient({ fetchImpl: fetchImpl as unknown as typeof fetch, log: () => undefined });
    expect((await caught(client.generateOtp({ numberE164: "+233241234567", message: "%otp_code%" }))).code).toBe("CONFIGURATION");
    expect(fetchImpl).not.toHaveBeenCalled();
    if (previous.key !== undefined) process.env.ARKESEL_API_KEY = previous.key;
    if (previous.sender !== undefined) process.env.ARKESEL_SENDER_ID = previous.sender;
  });
});

describe("OTP generate", () => {
  it("sends the documented request with the api-key header and configured sender ID", async () => {
    const { client, request, logs } = harness(response({ code: "1000", ussd_code: "*928*01#", message: "Successful, OTP is being processed for delivery" }));
    await expect(client.generateOtp({ numberE164: "+233241234567", message: "Your NesAfric verification code is %otp_code%." })).resolves.toEqual({ providerCode: "1000" });
    const { url, init, body } = request();
    expect(url).toBe(`${ARKESEL_BASE_URL}/api/otp/generate`);
    expect(url).toBe("https://sms.arkesel.com/api/otp/generate");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "api-key": KEY, "content-type": "application/json" });
    expect(body).toEqual({ expiry: 5, length: 6, medium: "sms", message: "Your NesAfric verification code is %otp_code%.", number: "233241234567", sender_id: "NesAfric", type: "numeric" });
    expect(logs).toEqual([expect.objectContaining({ event: "messaging.arkesel", operation: "otp.generate", recipient: "+233 24 *** 4567", ok: true, providerCode: "1000", httpStatus: 200 })]);
    expect(typeof logs[0].correlationId).toBe("string");
    expect(typeof logs[0].durationMs).toBe("number");
    noSecrets(logs);
  });

  it("refuses a message without the %otp_code% slot", async () => {
    const { client, fetchImpl } = harness(response({}));
    expect((await caught(client.generateOtp({ numberE164: "+233241234567", message: "no slot" }))).code).toBe("CONFIGURATION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["1003", 422, "SENDER_ID"],
    ["1004", 422, "CONFIGURATION"],
    ["1005", 422, "INVALID_PHONE"],
    ["1006", 422, "INVALID_PHONE"],
    ["1007", 422, "INSUFFICIENT_BALANCE"],
    ["1008", 200, "INSUFFICIENT_BALANCE"],
    ["1011", 500, "PROVIDER_UNAVAILABLE"],
  ])("maps Arkesel code %s (HTTP %i) to %s without leaking the provider body", async (code, status, expected) => {
    const { client, logs } = harness(response({ code, message: `Provider says 233241234567 ${CODE} rejected` }, status));
    const error = await caught(client.generateOtp({ numberE164: "+233241234567", message: "%otp_code%" }));
    expect(error).toBeInstanceOf(MessagingError);
    expect(error.code).toBe(expected);
    expect(error.details).toMatchObject({ provider: "arkesel", providerCode: code, httpStatus: status });
    expect(error.message).not.toContain("Provider says");
    noSecrets(error);
    noSecrets(logs);
  });

  it.each([
    [401, "CONFIGURATION"],
    [429, "RATE_LIMITED"],
    [502, "PROVIDER_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"],
  ])("maps a bare HTTP %i to %s", async (status, expected) => {
    const { client } = harness(response(null, status));
    expect((await caught(client.generateOtp({ numberE164: "+233241234567", message: "%otp_code%" }))).code).toBe(expected);
  });

  it("treats an unexpected 200 as a malformed response, not success", async () => {
    const { client } = harness(response({ something: "else" }));
    expect((await caught(client.generateOtp({ numberE164: "+233241234567", message: "%otp_code%" }))).code).toBe("MALFORMED_RESPONSE");
  });

  it("maps network failures and timeouts to a retryable PROVIDER_UNAVAILABLE", async () => {
    for (const failure of [new TypeError("fetch failed"), Object.assign(new Error("timed out"), { name: "TimeoutError" })]) {
      const { client } = harness(() => Promise.reject(failure));
      const error = await caught(client.generateOtp({ numberE164: "+233241234567", message: "%otp_code%" }));
      expect(error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(error.details.retryable).toBe(true);
    }
  });

  it("rejects a number that isn't E.164 before calling Arkesel", async () => {
    const { client, fetchImpl } = harness(response({}));
    expect((await caught(client.generateOtp({ numberE164: "0241234567", message: "%otp_code%" }))).code).toBe("INVALID_PHONE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("OTP verify", () => {
  it("sends { code, number } and normalises success", async () => {
    const { client, request, logs } = harness(response({ code: "1100", message: "Successful" }));
    await expect(client.verifyOtp({ numberE164: "+233241234567", code: CODE })).resolves.toEqual({ ok: true, provider: "arkesel", providerCode: "1100" });
    expect(request().url).toBe("https://sms.arkesel.com/api/otp/verify");
    expect(request().init.headers).toMatchObject({ "api-key": KEY });
    expect(request().body).toEqual({ code: CODE, number: "233241234567" });
    noSecrets(logs);
  });

  it("returns invalid and expired codes as results, and logs neither the code nor the key", async () => {
    for (const [code, reason] of [["1104", "invalid"], ["1105", "expired"]] as const) {
      const { client, logs } = harness(response({ code, message: code === "1104" ? "Invalid code" : "Code has expired" }, 422));
      await expect(client.verifyOtp({ numberE164: "+233241234567", code: CODE })).resolves.toEqual({ ok: false, provider: "arkesel", reason, providerCode: code });
      expect(logs[0]).toMatchObject({ ok: false, errorCode: reason === "expired" ? "OTP_EXPIRED" : "OTP_INVALID" });
      noSecrets(logs);
    }
  });

  it.each([
    ["1102", "INVALID_PHONE"],
    ["1103", "INVALID_PHONE"],
    ["1106", "PROVIDER_UNAVAILABLE"],
  ])("maps verify code %s to %s", async (code, expected) => {
    const { client } = harness(response({ code }, code === "1106" ? 500 : 422));
    expect((await caught(client.verifyOtp({ numberE164: "+233241234567", code: CODE }))).code).toBe(expected);
  });
});

describe("transactional SMS", () => {
  it("normalises recipients to E.164 and sends the documented v2 request", async () => {
    const { client, request } = harness(response({ status: "success", data: [{ recipient: "233241234567", id: "9b752841-7ee7-4d40-b4fe-768bfb1da4f0" }] }));
    await expect(sendTransactionalSms({ to: "024 123 4567", message: "Your viewing is confirmed." }, client)).resolves.toEqual({ status: "SENT", providerReferences: ["arkesel:9b752841-7ee7-4d40-b4fe-768bfb1da4f0"] });
    expect(request().url).toBe("https://sms.arkesel.com/api/v2/sms/send");
    expect(request().init.headers).toMatchObject({ "api-key": KEY });
    expect(request().body).toEqual({ sender: "NesAfric", message: "Your viewing is confirmed.", recipients: ["233241234567"] });
  });

  it("supports Arkesel's unbilled sandbox for testing", async () => {
    const { client, request } = harness(response({ status: "success", data: [{ recipient: "233241234567", id: "x" }] }));
    await sendTransactionalSms({ to: "+233241234567", message: "Test", sandbox: true }, client);
    expect(request().body.sandbox).toBe(true);
  });

  it("refuses invalid numbers and bulk sends before calling Arkesel", async () => {
    const { client, fetchImpl } = harness(response({}));
    expect((await caught(sendTransactionalSms({ to: ["0241234567", "12345"], message: "Hi" }, client))).code).toBe("INVALID_PHONE");
    const many = Array.from({ length: MAX_TRANSACTIONAL_RECIPIENTS + 1 }, (_, index) => `024123${String(index).padStart(4, "0")}`);
    expect((await caught(sendTransactionalSms({ to: many, message: "Hi" }, client))).code).toBe("CONFIGURATION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [402, { status: "error", message: "Insufficient balance or invalid coverage!" }, "INSUFFICIENT_BALANCE"],
    [403, { status: "error", message: "Inactive SMS Gateway!" }, "CONFIGURATION"],
    [422, { status: "error", message: "The sender field is invalid." }, "SENDER_ID"],
    [500, { status: "error", message: "SMS request failed!" }, "PROVIDER_UNAVAILABLE"],
    [200, { status: "success", data: [{ "invalid numbers": ["233241234567"] }] }, "INVALID_PHONE"],
  ])("maps SMS v2 HTTP %i to a normalised error", async (status, body, expected) => {
    const { client } = harness(response(body, status));
    const error = await caught(sendTransactionalSms({ to: "0241234567", message: "Hi" }, client));
    expect(error.code).toBe(expected);
    noSecrets(error);
  });
});
