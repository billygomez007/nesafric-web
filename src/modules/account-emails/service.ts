import { db } from "@/platform/database/client";
import { enqueueJob } from "@/platform/jobs/runner";
import { EmailChannelAdapter } from "@/modules/conversations/channels/registry";
import { BRAND } from "@/platform/brand";
import { renderEmail, type EmailContent } from "@/modules/notifications/email-templates/render";

/**
 * Account-level transactional email (welcome, onboarding completion) — deliberately NOT modeled
 * as a `Notification` row, because that table's `organisationId` is a required, non-null foreign
 * key (every other notification is organisation-scoped by design). A brand-new user has no
 * organisation yet, so these are sent as plain background jobs through the same job queue and the
 * same `EmailChannelAdapter` every other email already uses — reusing the existing
 * queue/idempotency/provider architecture without forcing an account-level concept into a
 * table that was never shaped for it.
 */
export type AccountEmailTemplate = "WELCOME" | "ONBOARDING_COMPLETE_PROPERTYOS" | "ONBOARDING_COMPLETE_MARKETPLACE";

export type AccountEmailPayload = { userId: string; template: AccountEmailTemplate; workspaceName?: string };

/** `enqueueJob` upserts on `idempotencyKey` (a no-op on conflict), so calling this any number of
 * times for the same user/template only ever results in one queued — and later, one sent — email,
 * even across registration retries or duplicate callback deliveries. */
export async function enqueueWelcomeEmail(userId: string) {
  return enqueueJob({
    type: "account-email",
    idempotencyKey: `account-email:welcome:${userId}`,
    payload: { userId, template: "WELCOME" } satisfies AccountEmailPayload,
  });
}

export async function enqueueOnboardingCompleteEmail(userId: string, template: "ONBOARDING_COMPLETE_PROPERTYOS" | "ONBOARDING_COMPLETE_MARKETPLACE", workspaceName: string) {
  return enqueueJob({
    type: "account-email",
    idempotencyKey: `account-email:${template}:${userId}`,
    payload: { userId, template, workspaceName } satisfies AccountEmailPayload,
  });
}

export function contentFor(template: AccountEmailTemplate, displayName: string, workspaceName?: string): { subject: string; sender: keyof typeof BRAND.sender; content: EmailContent } {
  switch (template) {
    case "WELCOME":
      return {
        subject: `Welcome to ${BRAND.name}`,
        sender: "hello",
        content: {
          heading: `Welcome to ${BRAND.name}.`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `Thanks for creating your ${BRAND.name} account. ${BRAND.name} gives you two ways to work: Manage Properties — run your portfolio, tenants, leases and rent collection — and Market Properties — build a professional profile and list, promote and sell or let real estate.`,
            "You can set up either workspace now, and add the other one later from the same account.",
          ],
          cta: { label: "Complete your setup", path: "/onboarding" },
        },
      };
    case "ONBOARDING_COMPLETE_PROPERTYOS":
      return {
        subject: "Your UmoAfric organisation is ready",
        sender: "hello",
        content: {
          heading: `${workspaceName ?? "Your organisation"} is ready`,
          greeting: `Hi ${displayName},`,
          paragraphs: [`Your UmoAfric organisation, ${workspaceName ?? "your new organisation"}, has been created. You can now add properties, invite your team, and start managing your portfolio.`],
          cta: { label: "Go to your dashboard", path: "/dashboard" },
        },
      };
    case "ONBOARDING_COMPLETE_MARKETPLACE":
      return {
        subject: "Your marketplace profile is ready",
        sender: "hello",
        content: {
          heading: `${workspaceName ?? "Your profile"} is ready`,
          greeting: `Hi ${displayName},`,
          paragraphs: [`Your ${BRAND.name} Marketplace professional profile, ${workspaceName ?? "your new profile"}, has been created. You can now publish listings, manage leads and build your public presence.`],
          cta: { label: "Go to your workspace", path: "/pro" },
        },
      };
  }
}

export async function sendAccountEmail(payload: AccountEmailPayload) {
  const user = await db.user.findUnique({ where: { id: payload.userId }, select: { email: true, displayName: true } });
  if (!user) return; // Account no longer exists between enqueue and processing — nothing to send.
  const { subject, sender, content } = contentFor(payload.template, user.displayName, payload.workspaceName);
  const rendered = renderEmail(content);
  const adapter = new EmailChannelAdapter();
  const result = await adapter.send({
    organisationId: "", // Account-level email, not associated with any organisation; unused by this adapter.
    conversationId: `account-email:${payload.template}:${payload.userId}`,
    messageId: `account-email:${payload.template}:${payload.userId}`,
    channel: "EMAIL",
    recipientAddress: user.email,
    fromAddress: BRAND.sender[sender],
    subject,
    html: rendered.html,
    body: rendered.text,
    replyTo: BRAND.contact.hello,
  });
  if (result.status === "FAILED") throw new Error(result.failureReason ?? "Account email delivery failed.");
}
