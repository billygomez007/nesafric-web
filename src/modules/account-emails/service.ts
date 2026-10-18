import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { enqueueJob } from "@/platform/jobs/runner";

/** Lets a caller commit the email job atomically with its own writes. */
type JobClient = Pick<Prisma.TransactionClient, "backgroundJob">;
import { EmailChannelAdapter } from "@/modules/conversations/channels/registry";
import { BRAND } from "@/platform/brand";
import {
  decryptInvitationToken,
  encryptInvitationToken,
  type EncryptedInvitationToken,
} from "@/platform/security/invitation-token-crypto";
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
  | "VIEWING_REQUEST_CREATED"
  | "TEAM_INVITATION"
  | "TENANT_ACCESS_INVITATION"
  | "ACCOMMODATION_BOOKING_REQUESTED"
  | "ACCOMMODATION_BOOKING_RECEIPT"
  | "ACCOMMODATION_BOOKING_CONFIRMED"
  | "ACCOMMODATION_BOOKING_DECLINED"
  | "ACCOMMODATION_BOOKING_CANCELLED";

/** Booking emails to the guest go to the address they gave; a guest needn't have an account. */
const GUEST_BOOKING_TEMPLATES = new Set<AccountEmailTemplate>([
  "ACCOMMODATION_BOOKING_RECEIPT",
  "ACCOMMODATION_BOOKING_CONFIRMED",
  "ACCOMMODATION_BOOKING_DECLINED",
  "ACCOMMODATION_BOOKING_CANCELLED",
]);

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

  /** Accommodation booking templates only. */
  bookingId?: string;
  bookingReference?: string;
  checkInLabel?: string;
  checkOutLabel?: string;
  nights?: number;
  guestsLabel?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  specialRequest?: string;

  /** Team-invitation fields. Invitation recipients may not have a NesAfric user account yet,
   * therefore invitation delivery can target a verified invitation email directly instead of
   * requiring a User row. */
  recipientEmail?: string;
  recipientDisplayName?: string;
  inviterName?: string;
  roleLabel?: string;
  invitationExpiresAt?: string;
  invitationId?: string;
  invitationTokenEncrypted?: EncryptedInvitationToken;

  /** Tenant access invitation. The raw access code is encrypted before it is
   * persisted in the background-job payload and decrypted only for delivery. */
  tenantAccessCodeEncrypted?: EncryptedInvitationToken;
  tenantOrganisationId?: string;
  propertyName?: string;

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
  client: JobClient = db,
) {
  const dedupeKey = `account-email:${template}:${userId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: { userId, template, workspaceName, dedupeKey } satisfies AccountEmailPayload,
  }, client);
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
export async function enqueueMarketplaceLeadNotification(recipientUserId: string, input: { listingTitle: string; leadId: string; prospectName: string; prospectEmail?: string; prospectPhone?: string }, client: JobClient = db) {
  const dedupeKey = `account-email:MARKETPLACE_LEAD_CREATED:${input.leadId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: recipientUserId, template: "MARKETPLACE_LEAD_CREATED", dedupeKey,
      listingTitle: input.listingTitle, leadId: input.leadId, prospectName: input.prospectName,
      prospectEmail: input.prospectEmail, prospectPhone: input.prospectPhone,
    } satisfies AccountEmailPayload,
  }, client);
}

/** Same recipient-resolution rule as the lead notification above, keyed to the viewing request's
 * own id. */
export async function enqueueViewingRequestNotification(recipientUserId: string, input: { listingTitle: string; viewingRequestId: string; prospectName: string; requestedTimeLabel?: string }, client: JobClient = db) {
  const dedupeKey = `account-email:VIEWING_REQUEST_CREATED:${input.viewingRequestId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: recipientUserId, template: "VIEWING_REQUEST_CREATED", dedupeKey,
      listingTitle: input.listingTitle, viewingRequestId: input.viewingRequestId, prospectName: input.prospectName,
      requestedTimeLabel: input.requestedTimeLabel,
    } satisfies AccountEmailPayload,
  }, client);
}

export type BookingEmailDetails = {
  bookingId: string;
  bookingReference: string;
  listingTitle: string;
  checkInLabel: string;
  checkOutLabel: string;
  nights: number;
  guestsLabel: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  specialRequest?: string;
};

/** New booking request → the listing's operator (same recipient rule as a lead: the listing's creator). */
export async function enqueueBookingRequestedEmail(recipientUserId: string, details: BookingEmailDetails) {
  const dedupeKey = `account-email:ACCOMMODATION_BOOKING_REQUESTED:${details.bookingId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: { userId: recipientUserId, template: "ACCOMMODATION_BOOKING_REQUESTED", dedupeKey, ...details } satisfies AccountEmailPayload,
  });
}

/** Receipt, confirmation, decline or cancellation → the guest's own address. */
export async function enqueueGuestBookingEmail(template: "ACCOMMODATION_BOOKING_RECEIPT" | "ACCOMMODATION_BOOKING_CONFIRMED" | "ACCOMMODATION_BOOKING_DECLINED" | "ACCOMMODATION_BOOKING_CANCELLED", details: BookingEmailDetails) {
  const dedupeKey = `account-email:${template}:${details.bookingId}`;
  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: "",
      template,
      dedupeKey,
      recipientEmail: details.guestEmail,
      recipientDisplayName: details.guestName,
      bookingId: details.bookingId,
      bookingReference: details.bookingReference,
      listingTitle: details.listingTitle,
      checkInLabel: details.checkInLabel,
      checkOutLabel: details.checkOutLabel,
      nights: details.nights,
      guestsLabel: details.guestsLabel,
    } satisfies AccountEmailPayload,
  });
}

export async function enqueueTenantAccessInvitationEmail(input: {
  invitationId: string;
  tenantOrganisationId: string;
  recipientEmail: string;
  recipientDisplayName: string;
  workspaceName: string;
  propertyName?: string;
  invitationExpiresAt: Date;
  accessCode: string;
}) {
  const dedupeKey =
    `account-email:TENANT_ACCESS_INVITATION:${input.invitationId}`;

  const tenantAccessCodeEncrypted =
    encryptInvitationToken(
      input.accessCode,
      input.invitationId,
    );

  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: "",
      template: "TENANT_ACCESS_INVITATION",
      dedupeKey,
      recipientEmail: input.recipientEmail.toLowerCase(),
      recipientDisplayName: input.recipientDisplayName,
      workspaceName: input.workspaceName,
      propertyName: input.propertyName,
      invitationExpiresAt:
        input.invitationExpiresAt.toISOString(),
      invitationId: input.invitationId,
      tenantOrganisationId: input.tenantOrganisationId,
      tenantAccessCodeEncrypted,
    } satisfies AccountEmailPayload,
  });
}

export async function enqueueTeamInvitationEmail(input: {
  invitationId: string;
  recipientEmail: string;
  organisationName: string;
  inviterName: string;
  roleLabel: string;
  invitationExpiresAt: Date;
  invitationToken: string;
}) {
  const dedupeKey = `account-email:TEAM_INVITATION:${input.invitationId}`;

  const invitationTokenEncrypted =
    encryptInvitationToken(
      input.invitationToken,
      input.invitationId,
    );

  return enqueueJob({
    type: "account-email",
    idempotencyKey: dedupeKey,
    payload: {
      userId: "",
      template: "TEAM_INVITATION",
      dedupeKey,
      recipientEmail: input.recipientEmail.toLowerCase(),
      workspaceName: input.organisationName,
      inviterName: input.inviterName,
      roleLabel: input.roleLabel,
      invitationExpiresAt:
        input.invitationExpiresAt.toISOString(),
      invitationId: input.invitationId,
      invitationTokenEncrypted,
    } satisfies AccountEmailPayload,
  });
}

export function contentFor(
  template: AccountEmailTemplate,
  displayName: string,
  workspaceName?: string,
  providerId?: string,
  reason?: string,
  lead?: Pick<
    AccountEmailPayload,
    | "listingTitle"
    | "prospectName"
    | "prospectEmail"
    | "prospectPhone"
    | "leadId"
    | "viewingRequestId"
    | "requestedTimeLabel"
    | "inviterName"
    | "roleLabel"
    | "invitationExpiresAt"
    | "propertyName"
    | "bookingId"
    | "bookingReference"
    | "checkInLabel"
    | "checkOutLabel"
    | "nights"
    | "guestsLabel"
    | "guestName"
    | "guestEmail"
    | "guestPhone"
    | "specialRequest"
  > & {
    invitationToken?: string;
  },
): { subject: string; sender: keyof typeof BRAND.sender; content: EmailContent } {
  switch (template) {
    case "WELCOME":
      return {
        subject: `Welcome to ${BRAND.name}`,
        sender: "hello",
        content: {
          preheader: `Welcome to ${BRAND.name} — your real estate operating system is ready.`,
          heading: `Welcome to ${BRAND.name}`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `Thank you for joining ${BRAND.name}. You're now part of a growing real estate ecosystem built for property managers, landlords, professionals and real estate businesses.`,
            `${BRAND.name} brings property management, marketplace tools, payments, maintenance, professional workflows, team collaboration and intelligent automation into one connected platform.`,
          ],
          steps: [
            {
              title: "Set up your workspace",
              description: "Complete your organisation or professional profile and choose how you want to use NesAfric.",
            },
            {
              title: "Add your first property",
              description: "Start managing a property, create a listing, or build your real estate portfolio.",
            },
            {
              title: "Invite your team",
              description: "Bring your team on board and manage operations together from one connected workspace.",
            },
          ],
          features: ["Manage", "Market", "Connect", "Automate"],
          cta: { label: "Get Started", path: "/onboarding" },
          supportNote: `Need help getting started? Contact ${BRAND.contact.support}`,
        },
      };
    case "ONBOARDING_COMPLETE_PROPERTYOS":
      return {
        subject: `Welcome to ${BRAND.name} — your property workspace is ready`,
        sender: "hello",
        content: {
          preheader: `${workspaceName ?? "Your property workspace"} is ready on ${BRAND.name}.`,
          heading: `Welcome to ${BRAND.name}`,
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `Your property workspace, ${workspaceName ?? "your organisation"}, is now ready.`,
            `${BRAND.name} gives you one place to manage properties, tenants, leases, rent, recurring charges, maintenance and your team.`,
            "You can start by adding your first property or continue setting up the rest of your workspace.",
          ],
          features: [
            "Add and manage properties",
            "Add tenants and leases",
            "Track rent and recurring charges",
            "Manage maintenance",
            "Invite your team",
          ],
          cta: { label: "Open your workspace", path: "/dashboard" },
          supportNote: `Need help? Reply to this email or contact ${BRAND.contact.hello}`,
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
    case "TENANT_ACCESS_INVITATION": {
      const expiry = lead?.invitationExpiresAt
        ? new Date(lead.invitationExpiresAt).toLocaleDateString(
            "en-GB",
            {
              day: "numeric",
              month: "long",
              year: "numeric",
            },
          )
        : "7 days";

      return {
        subject: `Your tenant access code for ${workspaceName ?? BRAND.name}`,
        sender: "notifications",
        content: {
          preheader: `Use your tenant access code to connect your tenancy to your ${BRAND.name} account.`,
          heading: "Your tenant access code",
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `${workspaceName ?? "Your landlord or property manager"} has added you as a tenant on ${BRAND.name}.`,
            lead?.propertyName
              ? `This invitation is connected to ${lead.propertyName}.`
              : "This invitation is connected to your tenant record.",
            "Sign in or create your NesAfric account using this email address, then enter the tenant access code below.",
            `This code expires on ${expiry}.`,
          ],
          details: [
            {
              label: "Tenant access code",
              value: lead?.invitationToken ?? "—",
            },
            ...(lead?.propertyName
              ? [
                  {
                    label: "Property",
                    value: lead.propertyName,
                  },
                ]
              : []),
            {
              label: "Workspace",
              value:
                workspaceName ?? "NesAfric property workspace",
            },
          ],

          supportNote: `Keep this code private. If you were not expecting this invitation, contact ${BRAND.contact.support}.`,
        },
      };
    }

    case "TEAM_INVITATION": {
      const expiry = lead?.invitationExpiresAt
        ? new Date(lead.invitationExpiresAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "7 days";

      return {
        subject: `You've been invited to join ${workspaceName ?? "a workspace"} on ${BRAND.name}`,
        sender: "hello",
        content: {
          preheader: `${lead?.inviterName ?? "A workspace administrator"} invited you to join ${workspaceName ?? "their workspace"} on ${BRAND.name}.`,
          heading: `You're invited to ${workspaceName ?? BRAND.name}`,
          greeting: `Hello${displayName && displayName !== "there" ? ` ${displayName}` : ""},`,
          paragraphs: [
            `${lead?.inviterName ?? "A workspace administrator"} has invited you to join ${workspaceName ?? "their property workspace"} on ${BRAND.name}.`,
            `Your assigned role is ${lead?.roleLabel ?? "Team member"}.`,
            `This invitation expires ${lead?.invitationExpiresAt ? `on ${expiry}` : "in 7 days"}.`,
            "Use the same email address this invitation was sent to when signing in or creating your account.",
          ],
          details: [
            { label: "Workspace", value: workspaceName ?? "NesAfric workspace" },
            { label: "Role", value: lead?.roleLabel ?? "Team member" },
            { label: "Invited by", value: lead?.inviterName ?? "Workspace administrator" },
          ],
          cta: lead?.invitationToken
            ? {
                label: "Accept invitation",
                path: `/invitations/accept#token=${encodeURIComponent(lead.invitationToken)}`,
              }
            : { label: "Open NesAfric", path: "/login" },
          supportNote: `If you were not expecting this invitation, you can safely ignore this email. Need help? Contact ${BRAND.contact.hello}`,
        },
      };
    }
    case "ACCOMMODATION_BOOKING_REQUESTED":
      return {
        subject: `New booking request — ${lead?.listingTitle ?? "your listing"}`,
        sender: "notifications",
        content: {
          heading: "New booking request",
          greeting: `Hi ${displayName},`,
          paragraphs: [
            `${lead?.guestName ?? "A guest"} has asked to stay at ${lead?.listingTitle ? `"${lead.listingTitle}"` : "your listing"}. Confirm or decline the request in NesAfric.`,
          ],
          details: [
            { label: "Reference", value: lead?.bookingReference ?? "—" },
            { label: "Guest", value: lead?.guestName ?? "—" },
            { label: "Check-in", value: lead?.checkInLabel ?? "—" },
            { label: "Check-out", value: lead?.checkOutLabel ?? "—" },
            { label: "Nights", value: String(lead?.nights ?? "—") },
            { label: "Guests", value: lead?.guestsLabel ?? "—" },
            ...(lead?.guestEmail ? [{ label: "Email", value: lead.guestEmail }] : []),
            ...(lead?.guestPhone ? [{ label: "Phone", value: lead.guestPhone }] : []),
            ...(lead?.specialRequest ? [{ label: "Special requests", value: lead.specialRequest }] : []),
          ],
          cta: { label: "View the booking", path: "/leasing/bookings" },
        },
      };
    case "ACCOMMODATION_BOOKING_RECEIPT":
    case "ACCOMMODATION_BOOKING_CONFIRMED":
    case "ACCOMMODATION_BOOKING_DECLINED":
    case "ACCOMMODATION_BOOKING_CANCELLED": {
      const place = lead?.listingTitle ?? "the property";
      const copy = {
        ACCOMMODATION_BOOKING_RECEIPT: { subject: `Booking request sent — ${place}`, heading: "Booking request sent", text: `We've sent your booking request to ${place}. It isn't confirmed yet: the property will confirm or decline it, and we'll email you when they do.` },
        ACCOMMODATION_BOOKING_CONFIRMED: { subject: `Booking confirmed — ${place}`, heading: "Your booking is confirmed", text: `${place} has confirmed your booking request.` },
        ACCOMMODATION_BOOKING_DECLINED: { subject: `Booking request declined — ${place}`, heading: "Booking request declined", text: `${place} couldn't accept your booking request for these dates.` },
        ACCOMMODATION_BOOKING_CANCELLED: { subject: `Booking cancelled — ${place}`, heading: "Booking cancelled", text: `${place} has cancelled this booking.` },
      }[template];
      return {
        subject: copy.subject,
        sender: "notifications",
        content: {
          heading: copy.heading,
          greeting: `Hi ${displayName},`,
          paragraphs: [copy.text],
          details: [
            { label: "Reference", value: lead?.bookingReference ?? "—" },
            { label: "Property", value: place },
            { label: "Check-in", value: lead?.checkInLabel ?? "—" },
            { label: "Check-out", value: lead?.checkOutLabel ?? "—" },
            { label: "Guests", value: lead?.guestsLabel ?? "—" },
          ],
        },
      };
    }
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
  const invitationDelivery = payload.template === "TEAM_INVITATION";
  const tenantInvitationDelivery =
    payload.template === "TENANT_ACCESS_INVITATION";

  // Sent to an address in the payload rather than to an account.
  const directDelivery =
    invitationDelivery
    || tenantInvitationDelivery
    || GUEST_BOOKING_TEMPLATES.has(payload.template);

  const user = directDelivery || !payload.userId
    ? null
    : await db.user.findUnique({
        where: { id: payload.userId },
        select: { email: true, displayName: true },
      });

  if (!directDelivery && !user) {
    return; // Account no longer exists between enqueue and processing — nothing to send.
  }

  const recipientEmail = directDelivery ? payload.recipientEmail : user?.email;
  const displayName = directDelivery
    ? payload.recipientDisplayName ?? "there"
    : user?.displayName ?? "there";

  if (!recipientEmail) {
    if (!directDelivery) {
      // A phone-only account has no email yet: nothing to send, and nothing to retry.
      console.log(JSON.stringify({ event: "account-email.skipped", template: payload.template, reason: "no-email-on-account" }));
      return;
    }
    throw new Error("Account email has no recipient email address.");
  }

  let transientInvitationToken:
    | string
    | undefined;

  if (invitationDelivery) {
    if (
      !payload.invitationId ||
      !payload.invitationTokenEncrypted
    ) {
      throw new Error(
        "Team invitation email payload is missing its encrypted delivery token.",
      );
    }

    transientInvitationToken =
      decryptInvitationToken(
        payload.invitationTokenEncrypted,
        payload.invitationId,
      );
  }

  if (tenantInvitationDelivery) {
    if (
      !payload.invitationId
      || !payload.tenantAccessCodeEncrypted
    ) {
      throw new Error(
        "Tenant invitation email payload is missing its encrypted access code.",
      );
    }

    transientInvitationToken =
      decryptInvitationToken(
        payload.tenantAccessCodeEncrypted,
        payload.invitationId,
      );
  }

  const { subject, sender, content } = contentFor(
    payload.template,
    displayName,
    payload.workspaceName,
    payload.providerId,
    payload.reason,
    invitationDelivery || tenantInvitationDelivery
      ? {
          ...payload,
          invitationToken:
            transientInvitationToken,
        }
      : payload,
  );
  const rendered = renderEmail(content);
  const adapter = new EmailChannelAdapter();
  const dedupeKey = payload.dedupeKey ?? `account-email:${payload.template}:${payload.userId}`;
  const result = await adapter.send({
    organisationId: "", // Account-level email, not associated with any organisation; unused by this adapter.
    conversationId: dedupeKey,
    messageId: dedupeKey,
    channel: "EMAIL",
    recipientAddress: recipientEmail,
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
