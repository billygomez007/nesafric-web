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
  | "PROVIDER_VERIFICATION_REJECTED"
  | "MARKETPLACE_LEAD_CREATED"
  | "VIEWING_REQUEST_CREATED";

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
  /** Lead/viewing notification templates only. */
  listingTitle?: string;
  prospectName?: string;
  prospectEmail?: string;
  prospectPhone?: string;
  leadId?: string;
  viewingRequestId?: string;
  requestedTimeLabel?: string;
  /** The exact idempotency identity for this send — reused as both the job's BackgroundJob key
   * (set by the caller at enqueue time) and the message id handed to the email provider, so a
   * single logical event (e.g. one specific lead) can never produce two external sends even if
   * this job is retried. Defaults to `template:userId` for templates that only ever fire once per
   * user (kept for backward compatibility with existing enqueue call sites). */
  dedupeKey?: string;
};

/** `enqueueJob` upserts on `idempotencyKey` (a no-op on conflict), so calling this any number of
 * times for the same user/template only ever results in one queued — and later, one sent — email,
 * even across registration retries or duplicate callback deliveries. */
export async function enqueueWelcomeEmail(userId: string) {
  const dedupeKey = `account-email:welcome:${userId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: { userId, template: "WELCOME", dedupeKey } satisfies AccountEmailPayload,
  });
}

export async function enqueueOnboardingCompleteEmail(
  userId: string,
  template: "ONBOARDING_COMPLETE_PROPERTYOS" | "ONBOARDING_COMPLETE_MARKETPLACE" | "ONBOARDING_COMPLETE_SERVICES",
  workspaceName: string,
) {
  const dedupeKey = `account-email:${template}:${userId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: { userId, template, workspaceName, dedupeKey } satisfies AccountEmailPayload,
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
  const dedupeKey = `account-email:${template}:${historyId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: { userId: administratorUserId, template, providerId, reason, dedupeKey } satisfies AccountEmailPayload,
  });
}

/** Notifies the listing's responsible person (the assigned team member if one is already set,
 * otherwise the listing's own creator — both real, existing ownership fields, never a guessed
 * recipient) of a brand-new marketplace enquiry. Keyed to the lead's own id, since each lead is a
 * genuinely distinct event deserving its own email. */
export async function enqueueMarketplaceLeadNotification(recipientUserId: string, input: { listingTitle: string; leadId: string; prospectName: string; prospectEmail?: string; prospectPhone?: string }) {
  const dedupeKey = `account-email:MARKETPLACE_LEAD_CREATED:${input.leadId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: recipientUserId, template: "MARKETPLACE_LEAD_CREATED", dedupeKey,
      listingTitle: input.listingTitle, leadId: input.leadId, prospectName: input.prospectName,
      prospectEmail: input.prospectEmail, prospectPhone: input.prospectPhone,
    } satisfies AccountEmailPayload,
  });
}

/** Same recipient-resolution rule as the lead notification above, keyed to the viewing request's
 * own id. */
export async function enqueueViewingRequestNotification(recipientUserId: string, input: { listingTitle: string; viewingRequestId: string; prospectName: string; requestedTimeLabel?: string }) {
  const dedupeKey = `account-email:VIEWING_REQUEST_CREATED:${input.viewingRequestId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: recipientUserId, template: "VIEWING_REQUEST_CREATED", dedupeKey,
      listingTitle: input.listingTitle, viewingRequestId: input.viewingRequestId, prospectName: input.prospectName,
      requestedTimeLabel: input.requestedTimeLabel,
    } satisfies AccountEmailPayload,
  });
}

export function contentFor(
  template: AccountEmailTemplate,
  displayName: string,
  workspaceName?: string,
  providerId?: string,
  reason?: string,
  lead?: Pick<AccountEmailPayload, "listingTitle" | "prospectName" | "prospectEmail" | "prospectPhone" | "leadId" | "viewingRequestId" | "requestedTimeLabel">,
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
    case "MARKETPLACE_LEAD_CREATED":
      return {
        subject: `New property enquiry on ${BRAND.name}`,
        sender: "notifications",
        content: {
          heading: "New property enquiry",
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `You have a new enquiry on ${lead?.listingTitle ? `"${lead.listingTitle}"` : "your listing"} from ${lead?.prospectName ?? "a prospect"}.`,
          ],
          details: [
            { label: "Prospect", value: lead?.prospectName ?? "—" },
            ...(lead?.prospectEmail ? [{ label: "Email", value: lead.prospectEmail }] : []),
            ...(lead?.prospectPhone ? [{ label: "Phone", value: lead.prospectPhone }] : []),
          ],
          cta: lead?.leadId ? { label: "Open the lead", path: `/leasing/leads/${lead.leadId}` } : undefined,
        },
      };
    case "VIEWING_REQUEST_CREATED":
      return {
        subject: `New viewing request on ${BRAND.name}`,
        sender: "notifications",
        content: {
          heading: "New viewing request",
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `${lead?.prospectName ?? "A prospect"} has requested a viewing of ${lead?.listingTitle ? `"${lead.listingTitle}"` : "your listing"}.`,
          ],
          details: [
            { label: "Prospect", value: lead?.prospectName ?? "—" },
            ...(lead?.requestedTimeLabel ? [{ label: "Requested time", value: lead.requestedTimeLabel }] : []),
          ],
          cta: lead?.viewingRequestId ? { label: "Review the viewing request", path: `/leasing/viewings/${lead.viewingRequestId}` } : undefined,
        },
      };
  }
}

export async function sendAccountEmail(payload: AccountEmailPayload) {
  const user = await db.user.findUnique({ where: { id: payload.userId }, select: { email: true, displayName: true } });
  if (!user) return; // Account no longer exists between enqueue and processing — nothing to send.
  const { subject, sender, content } = contentFor(payload.template, user.displayName, payload.workspaceName, payload.providerId, payload.reason, payload);
  const rendered = renderEmail(content);
  const adapter = new EmailChannelAdapter();
  const dedupeKey = payload.dedupeKey ?? `account-email:${payload.template}:${payload.userId}`;
  const result = await adapter.send({
    organisationId: "", // Account-level email, not associated with any organisation; unused by this adapter.
    conversationId: dedupeKey,
    messageId: dedupeKey,
    channel: "EMAIL",
    recipientAddress: user.email,
    fromAddress: BRAND.sender[sender],
    subject,
    html: rendered.html,
    body: rendered.text,
    replyTo: BRAND.contact.support,
  });
  if (result.status === "FAILED") throw new Error(result.failureReason ?? "Account email delivery failed.");
  // Structured, secret-free operational log — the provider reference is an id, never sensitive,
  // and its prefix ("resend:" vs "test-email:") is exactly the truthful mode signal this whole
  // integration is built around; visible via `vercel logs` without needing database access.
  console.log(JSON.stringify({ event: "account-email.sent", template: payload.template, dedupeKey, providerReference: result.providerReference }));
}
