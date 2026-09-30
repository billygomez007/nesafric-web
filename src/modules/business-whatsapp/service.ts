import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import {
  businessWhatsAppConfigInputSchema,
  businessWhatsAppPreferencesInputSchema,
} from "./schemas";
import { normalizeBusinessWhatsAppNumber } from "./phone";

export type BusinessWhatsAppSubject =
  | { organisationId: string; serviceProviderId?: never }
  | { organisationId?: never; serviceProviderId: string };

const preferenceSelect = {
  inquiryNotifications: true,
  viewingNotifications: true,
  leadNotifications: true,
  savedPropertyNotifications: true,
  bookingNotifications: true,
  serviceRequestNotifications: true,
  messageNotifications: true,
  reviewNotifications: true,
  accountActivityNotifications: true,
} satisfies Prisma.BusinessWhatsAppConfigSelect;

const publicSelect = {
  id: true,
  organisationId: true,
  serviceProviderId: true,
  whatsappNumber: true,
  whatsappVerified: true,
  whatsappVerifiedAt: true,
  whatsappOptIn: true,
  whatsappOptInAt: true,
  whatsappNotificationsEnabled: true,
  ...preferenceSelect,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessWhatsAppConfigSelect;

function subjectWhere(subject: BusinessWhatsAppSubject) {
  return "organisationId" in subject
    ? { organisationId: subject.organisationId }
    : { serviceProviderId: subject.serviceProviderId };
}

function subjectCreate(subject: BusinessWhatsAppSubject) {
  return "organisationId" in subject
    ? { organisationId: subject.organisationId }
    : { serviceProviderId: subject.serviceProviderId };
}

export async function resolveServiceProviderWhatsAppSubject(
  serviceProviderId: string,
): Promise<BusinessWhatsAppSubject> {
  const provider = await db.serviceProvider.findUnique({
    where: { id: serviceProviderId },
    select: {
      id: true,
      type: true,
      companyOrganisationId: true,
    },
  });

  if (!provider) {
    throw new Error("Service provider not found.");
  }

  if (provider.type === "COMPANY") {
    if (!provider.companyOrganisationId) {
      throw new Error(
        "Company service provider does not have an organisation.",
      );
    }

    return { organisationId: provider.companyOrganisationId };
  }

  return { serviceProviderId: provider.id };
}

export async function resolveMarketplaceProfessionalWhatsAppSubject(
  professionalId: string,
): Promise<BusinessWhatsAppSubject> {
  const professional = await db.marketplaceProfessional.findUnique({
    where: { id: professionalId },
    select: { backingOrganisationId: true },
  });

  if (!professional) {
    throw new Error("Marketplace professional not found.");
  }

  return { organisationId: professional.backingOrganisationId };
}

export async function getBusinessWhatsAppConfig(
  subject: BusinessWhatsAppSubject,
) {
  return db.businessWhatsAppConfig.findFirst({
    where: subjectWhere(subject),
    select: publicSelect,
  });
}

export async function saveBusinessWhatsAppConfig(
  subject: BusinessWhatsAppSubject,
  input: unknown,
) {
  const parsed = businessWhatsAppConfigInputSchema.parse(input);
  const whatsappNumber = normalizeBusinessWhatsAppNumber(
    parsed.whatsappNumber,
  );

  const existing = await getBusinessWhatsAppConfig(subject);
  const numberChanged =
    existing !== null && existing.whatsappNumber !== whatsappNumber;
  const now = new Date();

  const preferences = {
    inquiryNotifications:
      parsed.inquiryNotifications ?? existing?.inquiryNotifications ?? true,
    viewingNotifications:
      parsed.viewingNotifications ?? existing?.viewingNotifications ?? true,
    leadNotifications:
      parsed.leadNotifications ?? existing?.leadNotifications ?? true,
    savedPropertyNotifications:
      parsed.savedPropertyNotifications ??
      existing?.savedPropertyNotifications ??
      true,
    bookingNotifications:
      parsed.bookingNotifications ?? existing?.bookingNotifications ?? true,
    serviceRequestNotifications:
      parsed.serviceRequestNotifications ??
      existing?.serviceRequestNotifications ??
      true,
    messageNotifications:
      parsed.messageNotifications ?? existing?.messageNotifications ?? true,
    reviewNotifications:
      parsed.reviewNotifications ?? existing?.reviewNotifications ?? true,
    accountActivityNotifications:
      parsed.accountActivityNotifications ??
      existing?.accountActivityNotifications ??
      true,
  };

  const verificationState = numberChanged
    ? {
        whatsappVerified: false,
        whatsappVerifiedAt: null,
        whatsappNotificationsEnabled: false,
      }
    : {
        whatsappNotificationsEnabled:
          Boolean(existing?.whatsappVerified) && parsed.whatsappOptIn,
      };

  const optInState = parsed.whatsappOptIn
    ? {
        whatsappOptIn: true,
        whatsappOptInAt:
          existing?.whatsappOptIn && existing.whatsappOptInAt
            ? existing.whatsappOptInAt
            : now,
      }
    : {
        whatsappOptIn: false,
        whatsappOptInAt: null,
        whatsappNotificationsEnabled: false,
      };

  if (existing) {
    return db.businessWhatsAppConfig.update({
      where: { id: existing.id },
      data: {
        whatsappNumber,
        ...preferences,
        ...verificationState,
        ...optInState,
      },
      select: publicSelect,
    });
  }

  return db.businessWhatsAppConfig.create({
    data: {
      ...subjectCreate(subject),
      whatsappNumber,
      whatsappVerified: false,
      whatsappVerifiedAt: null,
      whatsappOptIn: parsed.whatsappOptIn,
      whatsappOptInAt: parsed.whatsappOptIn ? now : null,
      whatsappNotificationsEnabled: false,
      ...preferences,
    },
    select: publicSelect,
  });
}

export async function updateBusinessWhatsAppPreferences(
  subject: BusinessWhatsAppSubject,
  input: unknown,
) {
  const parsed = businessWhatsAppPreferencesInputSchema.parse(input);
  const existing = await getBusinessWhatsAppConfig(subject);

  if (!existing) {
    throw new Error("WhatsApp notification settings have not been configured.");
  }

  return db.businessWhatsAppConfig.update({
    where: { id: existing.id },
    data: parsed,
    select: publicSelect,
  });
}

export async function markBusinessWhatsAppVerified(
  subject: BusinessWhatsAppSubject,
) {
  const existing = await getBusinessWhatsAppConfig(subject);

  if (!existing) {
    throw new Error("WhatsApp notification settings have not been configured.");
  }

  const now = new Date();

  return db.businessWhatsAppConfig.update({
    where: { id: existing.id },
    data: {
      whatsappVerified: true,
      whatsappVerifiedAt: now,
      whatsappNotificationsEnabled: existing.whatsappOptIn,
    },
    select: publicSelect,
  });
}

export async function revokeBusinessWhatsAppConsent(
  subject: BusinessWhatsAppSubject,
) {
  const existing = await getBusinessWhatsAppConfig(subject);

  if (!existing) {
    return null;
  }

  return db.businessWhatsAppConfig.update({
    where: { id: existing.id },
    data: {
      whatsappOptIn: false,
      whatsappOptInAt: null,
      whatsappNotificationsEnabled: false,
    },
    select: publicSelect,
  });
}

export async function resolveBusinessWhatsAppDestination(
  subject: BusinessWhatsAppSubject,
) {
  const config = await getBusinessWhatsAppConfig(subject);

  if (
    !config ||
    !config.whatsappVerified ||
    !config.whatsappOptIn ||
    !config.whatsappNotificationsEnabled
  ) {
    return null;
  }

  return {
    configId: config.id,
    whatsappNumber: config.whatsappNumber,
    preferences: {
      inquiryNotifications: config.inquiryNotifications,
      viewingNotifications: config.viewingNotifications,
      leadNotifications: config.leadNotifications,
      savedPropertyNotifications: config.savedPropertyNotifications,
      bookingNotifications: config.bookingNotifications,
      serviceRequestNotifications: config.serviceRequestNotifications,
      messageNotifications: config.messageNotifications,
      reviewNotifications: config.reviewNotifications,
      accountActivityNotifications:
        config.accountActivityNotifications,
    },
  };
}
