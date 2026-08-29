import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { errorResponse } from "@/platform/errors";

const RELEVANT_EVENTS = new Set(["email.sent", "email.delivered", "email.bounced", "email.complained", "email.delivery_delayed"]);

/**
 * Resend delivery-events webhook (email.sent/delivered/bounced/complained/delivery_delayed).
 * Signed using the same spec Svix (Resend's webhook delivery provider) and the `standardwebhooks`
 * package both implement — `resend` already depends on `standardwebhooks`, so no extra package was
 * needed. Fail-closed: an unconfigured or invalid signature is rejected outright, never silently
 * trusted, matching the same discipline as the existing billing-webhook receiver.
 *
 * Deliberately foundational rather than exhaustive: this verifies the signature and records a
 * structured, secret-free, PII-minimized log entry (correlatable by `email_id`, the same id
 * already stored as `resend:<id>` on the originating job's `providerReference`) so an admin can
 * confirm the webhook is wired up and firing. It does NOT yet reconcile delivery status back onto
 * any stored record — account-level emails (welcome, onboarding, verification) are fire-and-forget
 * `BackgroundJob` rows with no per-send tracking row to update, so there is nothing to write a
 * "DELIVERED" status onto without a schema change. That reconciliation is intentionally deferred;
 * Resend's own dashboard is the source of truth for individual delivery status today.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json({ error: { code: "WEBHOOK_NOT_CONFIGURED", message: "The Resend webhook signing secret is not configured." } }, { status: 503 });
    }
    const rawBody = await request.text();
    // Svix (and therefore Resend) sends both `svix-*` and `webhook-*` header names for the same
    // values, for compatibility with either the branded Svix SDK or the generic
    // `standardwebhooks` package (which only recognizes the `webhook-*` names) — fall back between
    // them defensively rather than assuming one specific naming.
    const headers = {
      "webhook-id": request.headers.get("webhook-id") ?? request.headers.get("svix-id") ?? "",
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? request.headers.get("svix-timestamp") ?? "",
      "webhook-signature": request.headers.get("webhook-signature") ?? request.headers.get("svix-signature") ?? "",
    };
    let payload: unknown;
    try {
      payload = new Webhook(secret).verify(rawBody, headers);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return NextResponse.json({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed." } }, { status: 401 });
      }
      throw error;
    }
    const event = payload as { type?: string; created_at?: string; data?: { email_id?: string } };
    if (event.type && RELEVANT_EVENTS.has(event.type)) {
      // Never logs recipient address, subject, or body — only the event type and Resend's own
      // email id, which is already the correlation key stored on our side.
      console.log(JSON.stringify({ source: "resend-webhook", type: event.type, emailId: event.data?.email_id, occurredAt: event.created_at }));
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
}
