import { randomUUID } from "node:crypto";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { createMarketplaceNativeListing, submitMarketplaceListingForReview } from "@/modules/listings/service";
import { verifyAndPublishListingForPlatform } from "@/modules/platform-admin/service";

export const PHOTO_URL = "https://images.nesafric.com/public/properties/test/cover.jpg";

export async function cleanWhatsAppDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "WhatsAppContact", "WhatsAppAction", "WhatsAppAssistantEvent", "BackgroundJob", "AuthOtpChallenge" CASCADE');
}

export async function platformAdmin(role: "SUPER_ADMIN" | "SUPPORT_AGENT" | "READ_ONLY" = "SUPER_ADMIN") {
  const user = await registerUser({ displayName: `Admin ${role}`, email: `admin-${randomUUID()}@example.com`, password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: user.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
  return { user, principal };
}

export function nativeListingInput(input: { title: string; locality: string; city: string; bedrooms?: number; rentMinor?: string; furnishing?: string; photo?: boolean }) {
  return {
    asset: {
      name: input.title, category: "APARTMENT", purpose: "RENT", bedrooms: input.bedrooms ?? 2, bathrooms: 2, currencyCode: "GHS", priceMinor: input.rentMinor ?? "400000",
      countryCode: "GH", city: input.city, locality: input.locality, amenities: [], mediaUrls: [], availableFrom: "2026-01-01", authorityEvidenceReady: true,
    },
    listing: {
      listingType: "RENT", category: "APARTMENT", title: input.title, publicDescription: "A bright, secure apartment close to shops and schools.",
      rentAmountMinor: input.rentMinor ?? "400000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-01-01",
      countryCode: "GH", city: input.city, locality: input.locality, furnishing: input.furnishing ?? null,
      media: input.photo === false ? [] : [{ type: "PHOTO", publicUrl: PHOTO_URL }], amenities: [],
    },
    listingAuthority: "MANAGING_AGENT",
  };
}

/** A professional whose owner is a normal website user, with one listing in review (not public). */
export async function listingInReview(title = "Two-bedroom apartment, East Legon", locality = "East Legon") {
  const owner = await registerUser({ displayName: "Agent Owner", email: `owner-${randomUUID()}@example.com`, password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: `Brokerage ${randomUUID().slice(0, 6)}`, countryCode: "GH" });
  const listing = await createMarketplaceNativeListing(owner.id, professional.id, nativeListingInput({ title, locality, city: "Accra" }));
  await submitMarketplaceListingForReview(owner.id, professional.id, listing.id, { evidence: { type: "owner_mandate", reference: "Mandate on file" } });
  return { owner, professional, listing };
}

/** As `listingInReview`, then verified and published by a platform admin. */
export async function publishedListing(title?: string, locality?: string) {
  const context = await listingInReview(title, locality);
  const { principal } = await platformAdmin();
  const fresh = await db.listing.findUniqueOrThrow({ where: { id: context.listing.id } });
  await verifyAndPublishListingForPlatform(principal, context.listing.id, { expectedUpdatedAt: fresh.updatedAt });
  return { ...context, admin: principal };
}
