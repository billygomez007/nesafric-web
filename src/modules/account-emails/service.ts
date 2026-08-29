import { db } from "@/platform/database/client";
import { enqueueJob } from "@/platform/jobs/runner";
import { EmailChannelAdapter } from "@/modules/conversations/channels/registry";
import { BRAND } from "@/platform/brand";
import { renderEmail, type EmailContent } from "@/modules/notifications/email-templates/render";

/**
 * Account-level transactional email (welcome, onboarding completion, service-professional
 * verification) — deliberately NOT modeled as a `Notification` row, because that table's
 * `organisationId` is a required, non-null foreign key (every other notification is
 * organisation-scoped by design). A brand-new user, and a self-registered directory-less service
 * provider, both have no organisation, so these are sent as plain background jobs through the same
 * job queue and the same `EmailChannelAdapter` every other email already uses — reusing the
 * existing queue/idempotency/provider architecture without forcing an account-level concept into a
 * table that was never shaped for it.
 */
export type AccountEmailTemplate =
  | "WELCOME"
  | "ONBOARDING_COMPLETE_PROPERTYOS"
  | "ONBOARDING_COMPLETE_MARKETPLACE"
  | "ONBOARDING_COMPLETE_SERVICES"
  | "PROVIDER_VERIFICATION_SUBMITTED"
  | "PROVIDER_VERIFICATION_MORE_INFO"
  | "PROVIDER_VERIFICATION_APPROVED"
  | "PROVIDER_VERIFICATION_REJECTED";

export type AccountEmailPayload = {
  userId: string;
  template: AccountEmailTemplate;
  workspaceName?: string;
  /** Service-provider verification templates only — builds the CTA link to that provider's own page. */
  providerId?: string;
  /** Service-provider verification templates only — the reviewer's user-facing note, if any. Never
   * internal-only review metadata; this is the same field a reviewer fills in specifically to
   * communicate outward, matching how `rejectionReason` is surfaced elsewhere in the app. */
  reason?: string;
};

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

export async function enqueueOnboardingCompleteEmail(
  userId: string,
  template: "ONBOARDING_COMPLETE_PROPERTYOS" | "ONBOARDING_COMPLETE_MARKETPLACE" | "ONBOARDING_COMPLETE_SERVICES",
  workspaceName: string,
) {
  return enqueueJob({
    type: "account-email",
    idempotencyKey: `account-email:${template}:${userId}`,
    payload: { userId, template, workspaceName } satisfies AccountEmailPayload,
  });
}

/**
 * Unlike `enqueueWelcomeEmail`/`enqueueOnboardingCompleteEmail` (each fires at most once ever per
 * user), a provider's verification status can change repeatedly (submitted → rejected →
 * resubmitted → approved), so a per-user-per-template idempotency key would silently swallow every
 * email after the first. `historyId` is the id of the `ProviderVerificationHistory` row created for
 * this specific transition — a real, once-per-transition token already produced by the same
 * transaction — so each actual status change gets its own email, while a duplicate enqueue for the
 * exact same transition (e.g. a retried request) still collapses to one send.
 */
export async function enqueueProviderVerificationEmail(
  administratorUserId: string,
  providerId: string,
  template: "PROVIDER_VERIFICATION_SUBMITTED" | "PROVIDER_VERIFICATION_MORE_INFO" | "PROVIDER_VERIFICATION_APPROVED" | "PROVIDER_VERIFICATION_REJECTED",
  historyId: string,
  reason?: string,
) {
  return enqueueJob({
    type: "account-email",
    idempotencyKey: `account-email:${template}:${historyId}`,
    payload: { userId: administratorUserId, template, providerId, reason } satisfies AccountEmailPayload,
  });
}

export function contentFor(
  template: AccountEmailTemplate,
  displayName: string,
  workspaceName?: string,
  providerId?: string,
  reason?: string,
): { subject: string; sender: keyof typeof BRAND.sender; content: EmailContent } {
  switch (template) {
    case "WELCOME":
      return {
        subject: `Welcome to ${BRAND.name}`,
        sender: "notifications",
        content: {
          preheader: `Your ${BRAND.name} account is ready — continue setting up your workspace.`,
          heading: `Welcome to ${BRAND.name}.`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `${BRAND.name} brings property operations, marketplace tools, professional workflows and intelligent automation into one connected real estate platform.`,
            "Continue your setup to start managing properties, marketing real estate, or offering property services — whichever fits you best.",
          ],
          features: ["Manage", "Market", "Connect", "Automate"],
          cta: { label: `Continue to ${BRAND.name}`, path: "/onboarding" },
          supportNote: `Need help getting started? Contact ${BRAND.contact.support}`,
        },
      };
    case "ONBOARDING_COMPLETE_PROPERTYOS":
      return {
        subject: `Your ${BRAND.name} organisation is ready`,
        sender: "notifications",
        content: {
          heading: `${workspaceName ?? "Your organisation"} is ready`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `Your ${BRAND.name} organisation, ${workspaceName ?? "your new organisation"}, has been created.`,
            "Start managing your properties, tenants, rent, maintenance and operations from one place.",
          ],
          cta: { label: "Go to your dashboard", path: "/dashboard" },
        },
      };
    case "ONBOARDING_COMPLETE_MARKETPLACE":
      return {
        subject: "Your marketplace profile is ready",
        sender: "notifications",
        content: {
          heading: `${workspaceName ?? "Your profile"} is ready`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `Your ${BRAND.name} Marketplace professional profile, ${workspaceName ?? "your new profile"}, has been created.`,
            "Start listing properties, managing leads, viewings and your professional real estate activity.",
          ],
          cta: { label: "Go to your workspace", path: "/pro" },
        },
      };
    case "ONBOARDING_COMPLETE_SERVICES":
      return {
        subject: `Your ${BRAND.name} service professional profile is ready`,
        sender: "notifications",
        content: {
          heading: `${workspaceName ?? "Your profile"} is ready`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `Your ${BRAND.name} service professional profile, ${workspaceName ?? "your new profile"}, has been created.`,
            "Complete your service-professional profile and verification to start becoming discoverable for property-related work.",
          ],
          cta: { label: "Complete your verification", path: "/providers" },
        },
      };
    case "PROVIDER_VERIFICATION_SUBMITTED":
      return {
        subject: `Verification submitted — ${BRAND.name}`,
        sender: "notifications",
        content: {
          heading: "Verification submitted",
          greeting: `Hi ${displayName},`,
          badge: { label: "Under review", tone: "neutral" },
          paragraphs: [
            "Thanks for submitting your verification documents. Our review team will check them and follow up as soon as possible.",
            "We'll email you as soon as a decision has been made.",
          ],
          cta: providerId ? { label: "View your profile", path: `/providers/${providerId}` } : undefined,
        },
      };
    case "PROVIDER_VERIFICATION_MORE_INFO":
      return {
        subject: `More information is required for your ${BRAND.name} verification`,
        sender: "notifications",
        content: {
          heading: "More information needed",
          greeting: `Hi ${displayName},`,
          badge: { label: "Action needed", tone: "warning" },
          paragraphs: [
            "Our review team needs some additional information before your verification can be completed.",
            ...(reason ? [`Note from our review team: ${reason}`] : []),
          ],
          cta: providerId ? { label: "Update your verification", path: `/providers/${providerId}` } : undefined,
        },
      };
    case "PROVIDER_VERIFICATION_APPROVED":
      return {
        subject: `Your ${BRAND.name} service professional profile is verified`,
        sender: "notifications",
        content: {
          heading: "You're verified",
          greeting: `Hi ${displayName},`,
          badge: { label: "Verified", tone: "positive" },
          paragraphs: [
            `Congratulations — your identity verification is complete. You're now eligible to appear in the ${BRAND.name} Property Services Marketplace and be considered for work opportunities.`,
          ],
          cta: providerId ? { label: "View your profile", path: `/providers/${providerId}` } : undefined,
        },
      };
    case "PROVIDER_VERIFICATION_REJECTED":
      return {
        subject: `Update on your ${BRAND.name} verification`,
        sender: "notifications",
        content: {
          heading: "Update on your verification",
          greeting: `Hi ${displayName},`,
          badge: { label: "Not approved", tone: "critical" },
          paragraphs: [
            "After review, we're unable to approve your verification at this time.",
            ...(reason ? [`Reason provided: ${reason}`] : []),
            "You're welcome to review the details and submit again, or contact our support team if you have questions.",
          ],
          cta: providerId ? { label: "Review and resubmit", path: `/providers/${providerId}` } : undefined,
        },
      };
  }
}

export async function sendAccountEmail(payload: AccountEmailPayload) {
  const user = await db.user.findUnique({ where: { id: payload.userId }, select: { email: true, displayName: true } });
  if (!user) return; // Account no longer exists between enqueue and processing — nothing to send.
  const { subject, sender, content } = contentFor(payload.template, user.displayName, payload.workspaceName, payload.providerId, payload.reason);
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
    replyTo: BRAND.contact.support,
  });
  if (result.status === "FAILED") throw new Error(result.failureReason ?? "Account email delivery failed.");
}
