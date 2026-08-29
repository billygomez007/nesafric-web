import { afterEach, describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { POST } from "@/app/api/webhooks/resend/route";

const TEST_SECRET = "whsec_dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz";

function signedRequest(body: object, secret = TEST_SECRET) {
  const payload = JSON.stringify(body);
  const id = "msg_test_1";
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(id, timestamp, payload);
  return new Request("https://umoafric.com/api/webhooks/resend", {
    method: "POST",
    body: payload,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    },
  });
}

describe("Resend webhook signature verification", () => {
  const originalSecret = process.env.RESEND_WEBHOOK_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = originalSecret;
  });

  it("rejects every event when no webhook secret is configured, never trusting an unsigned payload", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const response = await POST(signedRequest({ type: "email.sent", created_at: new Date().toISOString(), data: { email_id: "abc" } }));
    expect(response.status).toBe(503);
  });

  it("accepts a correctly-signed event once the secret is configured", async () => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    const response = await POST(signedRequest({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "abc-123" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: true });
  });

  it("rejects a payload signed with the wrong secret", async () => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    const wrongSecret = "whsec_d3Jvbmctc2VjcmV0LWZvci11bml0LXRlc3Rz";
    const response = await POST(signedRequest({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "abc" } }, wrongSecret));
    expect(response.status).toBe(401);
  });

  it("rejects a tampered payload even with a validly-signed header", async () => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    const request = signedRequest({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "abc" } });
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "a-different-email-id" } }),
    });
    const response = await POST(tampered);
    expect(response.status).toBe(401);
  });

  it("never includes the webhook secret in any response", async () => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    const response = await POST(signedRequest({ type: "email.sent", created_at: new Date().toISOString(), data: { email_id: "abc" } }));
    const text = await response.text();
    expect(text).not.toContain(TEST_SECRET);
  });
});
