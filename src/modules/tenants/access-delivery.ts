import { enqueueTenantAccessInvitationEmail } from "@/modules/account-emails/service";
import { sendTransactionalSms } from "@/modules/messaging/sms";
import { db } from "@/platform/database/client";

export async function deliverTenantAccessInvitation(input: {
  tenantOrganisationId: string;
  invitationId: string;
  expiresAt: Date;
  code: string;
  leaseId?: string;
}) {
  const relationship = await db.tenantOrganisation.findUnique({
    where: {
      id: input.tenantOrganisationId,
    },
    select: {
      email: true,
      phone: true,
      tenant: {
        select: {
          legalName: true,
        },
      },
      organisation: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!relationship) {
    return {
      email: "SKIPPED" as const,
      sms: "SKIPPED" as const,
    };
  }

  const exactLease = input.leaseId
    ? await db.lease.findFirst({
        where: {
          id: input.leaseId,
          parties: {
            some: {
              tenantOrganisationId: input.tenantOrganisationId,
            },
          },
        },
        select: {
          property: {
            select: {
              name: true,
            },
          },
        },
      })
    : null;

  const propertyName = exactLease?.property.name;

  let email: "QUEUED" | "SKIPPED" | "FAILED" = "SKIPPED";

  let sms: "SENT" | "SKIPPED" | "FAILED" = "SKIPPED";

  if (relationship.email) {
    try {
      await enqueueTenantAccessInvitationEmail({
        invitationId: input.invitationId,
        tenantOrganisationId: input.tenantOrganisationId,
        recipientEmail: relationship.email,
        recipientDisplayName: relationship.tenant.legalName,
        workspaceName: relationship.organisation.name,
        propertyName,
        invitationExpiresAt: input.expiresAt,
        accessCode: input.code,
      });

      email = "QUEUED";
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "tenant-access.email-delivery-failed",
          invitationId: input.invitationId,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );

      email = "FAILED";
    }
  }

  // A tenant access code is a one-time transactional access credential,
  // not an optional notification. If the landlord/property manager supplied
  // a phone number for this tenant relationship, deliver the invitation code.
  if (relationship.phone) {
    try {
      const place = propertyName ? ` for ${propertyName}` : "";

      await sendTransactionalSms({
        to: relationship.phone,
        message:
          `NesAfric tenant access code${place}: ` +
          `${input.code}. Sign in to NesAfric, then ` +
          `enter this code to connect your tenancy. ` +
          `Do not share this code.`,
      });

      sms = "SENT";
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "tenant-access.sms-delivery-failed",
          invitationId: input.invitationId,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );

      sms = "FAILED";
    }
  }

  return {
    email,
    sms,
  };
}
