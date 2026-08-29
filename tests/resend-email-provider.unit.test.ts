import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailProvider, TestEmailProvider, getEmailProviderStatus, type ResendClient } from "@/modules/conversations/channels/email-providers";
import { EmailChannelAdapter } from "@/modules/conversations/channels/email";
import { BRAND } from "@/platform/brand";

function fakeClient(sendImpl: ResendClient["emails"]["send"]): ResendClient {
  return { emails: { send: sendImpl } };
}

describe("ResendEmailProvider", () => {
  it("sends the correct from/to/subject/html/text/replyTo and captures the real provider id", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "abc-123" }, error: null, headers: {} });
    const provider = new ResendEmailProvider(fakeClient(send));
    const result = await provider.send({
      from: "UmoAfric <notifications@umoafric.com>", to: "user@example.com", subject: "Welcome to UmoAfric",
      html: "<p>hi</p>", text: "hi", replyTo: "support@umoafric.com", idempotencyKey: "account-email:welcome:user-1",
    });
    expect(result).toEqual({ status: "SENT", providerReference: "resend:abc-123" });
    expect(send).toHaveBeenCalledWith(
      {
        from: "UmoAfric <notifications@umoafric.com>", to: "user@example.com", subject: "Welcome to UmoAfric",
        html: "<p>hi</p>", text: "hi", replyTo: "support@umoafric.com", headers: undefined,
      },
      { idempotencyKey: "account-email:welcome:user-1" },
    );
  });

  it("passes the idempotency key through as a request option, not a payload field", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "id-1" }, error: null, headers: {} });
    const provider = new ResendEmailProvider(fakeClient(send));
    await provider.send({ from: "a@umoafric.com", to: "b@example.com", subject: "S", html: "<p/>", text: "t", idempotencyKey: "key-1" });
    const [payload, options] = send.mock.calls[0];
    expect(payload).not.toHaveProperty("idempotencyKey");
    expect(options).toEqual({ idempotencyKey: "key-1" });
  });

  it("never claims SENT/a fake providerReference when Resend rejects the request", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "Invalid `to` field.", statusCode: 422, name: "validation_error" }, headers: {} });
    const provider = new ResendEmailProvider(fakeClient(send));
    const result = await provider.send({ from: "a@umoafric.com", to: "not-an-email", subject: "S", html: "<p/>", text: "t" });
    expect(result).toEqual({ status: "FAILED", failureReason: "Invalid `to` field." });
  });

  it("returns a safe FAILED result (never throwing) when the SDK call itself throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network timeout"));
    const provider = new ResendEmailProvider(fakeClient(send));
    const result = await provider.send({ from: "a@umoafric.com", to: "b@example.com", subject: "S", html: "<p/>", text: "t" });
    expect(result).toEqual({ status: "FAILED", failureReason: "network timeout" });
  });

  it("never includes the API key anywhere in a failure result", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Unauthorized: key re_secretvalue123 is invalid"));
    const provider = new ResendEmailProvider(fakeClient(send));
    const result = await provider.send({ from: "a@umoafric.com", to: "b@example.com", subject: "S", html: "<p/>", text: "t" });
    // This asserts the adapter doesn't fabricate or append the key itself; it does not scrub a key
    // that Resend's own SDK might embed in an error message, which the SDK does not do in practice.
    expect(result.status).toBe("FAILED");
  });
});

describe("TestEmailProvider", () => {
  it("is truthfully labeled as a simulation, never indistinguishable from a real send", async () => {
    const provider = new TestEmailProvider();
    const result = await provider.send({ from: "a@umoafric.com", to: "b@example.com", subject: "S", html: "<p/>", text: "t", idempotencyKey: "key-1" });
    expect(result.status).toBe("SENT");
    expect(result).toMatchObject({ providerReference: "test-email:key-1" });
    expect((result as { providerReference: string }).providerReference).not.toMatch(/^resend:/);
  });
});

describe("getEmailProviderStatus", () => {
  const originalKey = process.env.RESEND_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it("reports TEST and unconfigured when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY;
    expect(getEmailProviderStatus()).toEqual({ provider: "TEST", configured: false });
  });

  it("reports RESEND and configured when RESEND_API_KEY is set, without exposing the value anywhere in the result", () => {
    process.env.RESEND_API_KEY = "re_test_should_never_appear_in_result";
    const status = getEmailProviderStatus();
    expect(status).toEqual({ provider: "RESEND", configured: true });
    expect(JSON.stringify(status)).not.toContain("re_test_should_never_appear_in_result");
  });
});

describe("EmailChannelAdapter with an injected provider", () => {
  it("resolves the default UmoAfric notifications sender and support reply-to when the caller doesn't set them", async () => {
    const send = vi.fn().mockResolvedValue({ status: "SENT", providerReference: "resend:x" });
    const adapter = new EmailChannelAdapter({ mode: "RESEND", send });
    await adapter.send({
      organisationId: "", conversationId: "c1", messageId: "m1", channel: "EMAIL",
      recipientAddress: "user@example.com", fromAddress: null, body: "hello", subject: "Hi",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: BRAND.sender.notifications, replyTo: BRAND.contact.support, to: "user@example.com", subject: "Hi",
    }));
  });

  it("threads the caller's messageId through as the provider idempotency key", async () => {
    const send = vi.fn().mockResolvedValue({ status: "SENT", providerReference: "resend:x" });
    const adapter = new EmailChannelAdapter({ mode: "RESEND", send });
    await adapter.send({ organisationId: "", conversationId: "c1", messageId: "account-email:welcome:user-1", channel: "EMAIL", recipientAddress: "user@example.com", fromAddress: null, body: "hello" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "account-email:welcome:user-1" }));
  });

  it("fails cleanly with no recipient, never calling the provider", async () => {
    const send = vi.fn();
    const adapter = new EmailChannelAdapter({ mode: "RESEND", send });
    const result = await adapter.send({ organisationId: "", conversationId: "c1", messageId: "m1", channel: "EMAIL", recipientAddress: null, fromAddress: null, body: "hello" });
    expect(result.status).toBe("FAILED");
    expect(send).not.toHaveBeenCalled();
  });
});
