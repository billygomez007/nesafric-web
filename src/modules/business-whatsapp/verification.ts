import { createHmac, randomUUID } from "crypto";
import { z } from "zod";

import { getSmsOtpProvider } from "@/modules/messaging/otp-provider";
import { isMessagingError } from "@/modules/messaging/errors";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import {
  ipRateLimitKey,
  resolveClientIdentity,
} from "@/platform/security/client-ip";

import {
  getBusinessWhatsAppConfig,
  markBusinessWhatsAppVerified,
  type BusinessWhatsAppSubject,
} from "./service";

export const BUSINESS_WHATSAPP_OTP_MAX_ATTEMPTS = 5;
export const BUSINESS_WHATSAPP_OTP_MAX_SENDS_PER_HOUR = 5;
export const BUSINESS_WHATSAPP_OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR = 20;
export const BUSINESS_WHATSAPP_OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

function otpSecret() {
  const secret = process.env.OTP_HASH_SECRET || process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new AppError(
      "BUSINESS_WHATSAPP_OTP_UNAVAILABLE",
      503,
      "WhatsApp verification is temporarily unavailable. Please try again later.",
    );
  }

  return secret;
}

function hmac(value: string) {
  return createHmac("sha256", otpSecret()).update(value).digest("hex");
}

function requesterHashFor(headers: Headers) {
  const { ip } = resolveClientIdentity(headers);

  /*
   * The business challenge schema intentionally requires a requester hash.
   * When infrastructure cannot provide a trusted IP, use a stable opaque
   * unknown-network bucket rather than storing an untrusted caller header.
   */
  return hmac(`business-whatsapp-requester:${ipRateLimitKey(ip)}`);
}

function rateLimited(message: string, retryAfterSeconds?: number) {
  return new AppError(
    "BUSINESS_WHATSAPP_OTP_RATE_LIMITED",
    429,
    message,
    retryAfterSeconds ? { retryAfterSeconds } : undefined,
  );
}

function unavailable() {
  return new AppError(
    "BUSINESS_WHATSAPP_OTP_UNAVAILABLE",
    503,
    "WhatsApp verification codes are temporarily unavailable. Please try again later.",
  );
}

function verifyUnavailable() {
  return new AppError(
    "BUSINESS_WHATSAPP_OTP_VERIFY_UNAVAILABLE",
    503,
    "We couldn’t check your verification code right now. Please try again in a moment.",
  );
}

function invalidCode() {
  return new AppError(
    "BUSINESS_WHATSAPP_OTP_INVALID",
    400,
    "That code is incorrect or has expired. Check it, or send a new code.",
  );
}

function expiredCode() {
  return new AppError(
    "BUSINESS_WHATSAPP_OTP_EXPIRED",
    400,
    "That code has expired. Send a new code to try again.",
  );
}

function smsTemplate(expiryMinutes: number) {
  return `Your NesAfric business WhatsApp verification code is %otp_code%. It expires in ${expiryMinutes} minutes. Do not share this code.`;
}

function maskPhone(number: string) {
  if (number.length <= 7) return number;
  return `${number.slice(0, 4)}••••${number.slice(-3)}`;
}

export async function requestBusinessWhatsAppVerification(
  subject: BusinessWhatsAppSubject,
  headers: Headers,
  now = new Date(),
) {
  const config = await getBusinessWhatsAppConfig(subject);

  if (!config) {
    throw new AppError(
      "BUSINESS_WHATSAPP_NOT_CONFIGURED",
      409,
      "Save a WhatsApp notification number before requesting verification.",
    );
  }

  if (config.whatsappVerified) {
    throw new AppError(
      "BUSINESS_WHATSAPP_ALREADY_VERIFIED",
      409,
      "This WhatsApp number is already verified.",
    );
  }

  const sms = getSmsOtpProvider();
  if (!sms.configured) throw unavailable();

  const challengeId = randomUUID();
  const requesterHash = requesterHashFor(headers);
  const expiresAt = new Date(
    now.getTime() + sms.expiryMinutes * 60 * 1000,
  );
  const hourAgo = new Date(now.getTime() - HOUR_MS);

  await db.$transaction(async (tx) => {
    /*
     * Serialize requests for one business configuration. This prevents
     * concurrent sends from racing the resend/hourly checks.
     */
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`business-whatsapp:${config.id}`}, 0)
      )
    `;

    const latest =
      await tx.businessWhatsAppVerificationChallenge.findFirst({
        where: { businessWhatsAppConfigId: config.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

    if (
      latest &&
      now.getTime() - latest.createdAt.getTime() <
        BUSINESS_WHATSAPP_OTP_RESEND_COOLDOWN_MS
    ) {
      const wait = Math.ceil(
        (
          BUSINESS_WHATSAPP_OTP_RESEND_COOLDOWN_MS -
          (now.getTime() - latest.createdAt.getTime())
        ) / 1000,
      );

      throw rateLimited(
        `Please wait ${wait} seconds before requesting another code.`,
        wait,
      );
    }

    const destinationCount =
      await tx.businessWhatsAppVerificationChallenge.count({
        where: {
          businessWhatsAppConfigId: config.id,
          createdAt: { gte: hourAgo },
        },
      });

    if (destinationCount >= BUSINESS_WHATSAPP_OTP_MAX_SENDS_PER_HOUR) {
      throw rateLimited(
        "Too many verification codes have been requested for this WhatsApp number. Please try again in an hour.",
      );
    }

    const requesterCount =
      await tx.businessWhatsAppVerificationChallenge.count({
        where: {
          requesterHash,
          createdAt: { gte: hourAgo },
        },
      });

    if (
      requesterCount >=
      BUSINESS_WHATSAPP_OTP_MAX_SENDS_PER_REQUESTER_PER_HOUR
    ) {
      throw rateLimited(
        "Too many verification codes have been requested from this network. Please try again later.",
      );
    }

    /*
     * Start inactive. A failed provider send must never invalidate the
     * previous usable challenge.
     */
    await tx.businessWhatsAppVerificationChallenge.create({
      data: {
        id: challengeId,
        businessWhatsAppConfigId: config.id,
        whatsappNumber: config.whatsappNumber,
        requesterHash,
        expiresAt,
        supersededAt: now,
      },
    });
  });

  try {
    await sms.generate(
      config.whatsappNumber,
      smsTemplate(sms.expiryMinutes),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "business-whatsapp-otp.delivery-failed",
        challengeId,
        reason: isMessagingError(error) ? error.code : "UNKNOWN",
      }),
    );

    if (isMessagingError(error) && error.code === "RATE_LIMITED") {
      throw rateLimited(
        "Too many requests. Please wait a minute and try again.",
      );
    }

    if (isMessagingError(error) && error.code === "INVALID_PHONE") {
      throw new AppError(
        "INVALID_PHONE",
        400,
        "We can’t send a verification code to this WhatsApp number. Check the number and try again.",
      );
    }

    throw unavailable();
  }

  await db.$transaction([
    db.businessWhatsAppVerificationChallenge.updateMany({
      where: {
        businessWhatsAppConfigId: config.id,
        id: { not: challengeId },
        consumedAt: null,
        supersededAt: null,
      },
      data: { supersededAt: new Date() },
    }),
    db.businessWhatsAppVerificationChallenge.update({
      where: { id: challengeId },
      data: { supersededAt: null },
    }),
  ]);

  return {
    challengeId,
    destination: maskPhone(config.whatsappNumber),
    expiresAt,
    resendAfterSeconds:
      BUSINESS_WHATSAPP_OTP_RESEND_COOLDOWN_MS / 1000,
  };
}

export async function verifyBusinessWhatsApp(
  subject: BusinessWhatsAppSubject,
  input: unknown,
  now = new Date(),
) {
  const data = verifySchema.parse(input);
  const config = await getBusinessWhatsAppConfig(subject);

  if (!config) throw invalidCode();

  const challenge =
    await db.businessWhatsAppVerificationChallenge.findUnique({
      where: { id: data.challengeId },
    });

  if (
    !challenge ||
    challenge.businessWhatsAppConfigId !== config.id ||
    challenge.whatsappNumber !== config.whatsappNumber ||
    challenge.consumedAt ||
    challenge.supersededAt ||
    challenge.expiresAt <= now ||
    challenge.failedAttempts >= BUSINESS_WHATSAPP_OTP_MAX_ATTEMPTS
  ) {
    throw invalidCode();
  }

  const sms = getSmsOtpProvider();
  if (!sms.configured) throw unavailable();

  let result;

  try {
    result = await sms.verify(config.whatsappNumber, data.code);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "business-whatsapp-otp.verify-unavailable",
        challengeId: challenge.id,
        reason: isMessagingError(error) ? error.code : "UNKNOWN",
      }),
    );

    throw verifyUnavailable();
  }

  if (!result.ok) {
    if (result.reason === "expired") {
      await db.businessWhatsAppVerificationChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
        },
        data: { expiresAt: now },
      });

      throw expiredCode();
    }

    await db.businessWhatsAppVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        supersededAt: null,
        failedAttempts: {
          lt: BUSINESS_WHATSAPP_OTP_MAX_ATTEMPTS,
        },
      },
      data: {
        failedAttempts: { increment: 1 },
      },
    });

    throw invalidCode();
  }

  /*
   * Consume first with a conditional update. Exactly one concurrent verify
   * request can win. Verification state changes only after that winner exists.
   */
  const consumed =
    await db.businessWhatsAppVerificationChallenge.updateMany({
      where: {
        id: challenge.id,
        businessWhatsAppConfigId: config.id,
        whatsappNumber: config.whatsappNumber,
        consumedAt: null,
        supersededAt: null,
        expiresAt: { gt: now },
        failedAttempts: {
          lt: BUSINESS_WHATSAPP_OTP_MAX_ATTEMPTS,
        },
      },
      data: { consumedAt: now },
    });

  if (consumed.count !== 1) throw invalidCode();

  return markBusinessWhatsAppVerified(subject);
}
