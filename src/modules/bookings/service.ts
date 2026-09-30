import { randomInt } from "crypto";

import { isBookableCategory, MAX_BOOKING_LEAD_DAYS, MAX_STAY_NIGHTS } from "@/lib/listing-categories";
import { enqueueBookingRequestedEmail, enqueueGuestBookingEmail, type BookingEmailDetails } from "@/modules/account-emails/service";
import { listingIdSchema } from "@/modules/listings/schemas";
import {
  isAssetAvailable,
  PUBLIC_LISTING_WHERE,
  record,
  requireProfessionalInboxAccess,
  requirePropertyOsOrMarketplaceAccess,
  type SubmissionBinding,
} from "@/modules/listings/service";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { db } from "@/platform/database/client";
import { Prisma, type AccommodationBooking, type AccommodationBookingStatus } from "@/platform/database/generated/client";
import { AppError, forbidden, notFound } from "@/platform/errors";
import {
  accommodationBookingListSchema,
  createAccommodationBookingSchema,
  updateAccommodationBookingStatusSchema,
} from "./schemas";

/**
 * Hotel and short-stay booking requests.
 *
 * - The recipient is always the listing's own organisation (and, through the listing, the
 *   professional marketing it), resolved here from the listing. The request can't name one.
 * - Only published, verified, available listings in a bookable category (HOTEL, SHORT_STAY) take
 *   requests; the dates, guest count and minimum stay are checked here, not only in the forms.
 * - There is no live room inventory, so a request is REQUESTED until the operator confirms or
 *   declines it. Nothing is ever confirmed automatically.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newReference() {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `NB-${code}`;
}

const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const todayUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const dateLabel = (value: Date) => value.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const guestsLabel = (adults: number, children: number) =>
  [`${adults} adult${adults === 1 ? "" : "s"}`, ...(children ? [`${children} child${children === 1 ? "" : "ren"}`] : [])].join(", ");

function invalidStay(message: string) {
  return new AppError("INVALID_BOOKING", 422, message);
}

/** What the guest (and anyone else outside the operator) may see of a booking. */
function publicBookingView(booking: AccommodationBooking, listingTitle: string) {
  return {
    reference: booking.reference,
    status: booking.status,
    listingId: booking.listingId,
    listingTitle,
    checkIn: booking.checkIn.toISOString().slice(0, 10),
    checkOut: booking.checkOut.toISOString().slice(0, 10),
    nights: booking.nights,
    adults: booking.adults,
    children: booking.children,
    createdAt: booking.createdAt,
  };
}

function emailDetails(booking: AccommodationBooking, listingTitle: string): BookingEmailDetails {
  return {
    bookingId: booking.id,
    bookingReference: booking.reference,
    listingTitle,
    checkInLabel: dateLabel(booking.checkIn),
    checkOutLabel: dateLabel(booking.checkOut),
    nights: booking.nights,
    guestsLabel: guestsLabel(booking.adults, booking.children),
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone ?? undefined,
    specialRequest: booking.specialRequest ?? undefined,
  };
}

export async function createAccommodationBooking(
  listingId: string,
  userId: string | undefined,
  input: unknown,
  options: { submission?: SubmissionBinding; now?: Date } = {},
) {
  listingId = listingIdSchema.parse(listingId);
  const data = createAccommodationBookingSchema.parse(input);
  const now = options.now ?? new Date();

  const checkIn = utcDate(data.checkIn);
  const checkOut = utcDate(data.checkOut);
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
  const guests = data.adults + data.children;
  if (checkIn < todayUtc(now)) throw invalidStay("Check-in can't be in the past.");
  if (nights < 1) throw invalidStay("Check-out must be after check-in.");
  if (nights > MAX_STAY_NIGHTS) throw invalidStay(`A stay request can be at most ${MAX_STAY_NIGHTS} nights.`);
  if (checkIn.getTime() - todayUtc(now).getTime() > MAX_BOOKING_LEAD_DAYS * DAY_MS) throw invalidStay("Stays can be requested up to a year ahead.");

  const created = await db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, ...PUBLIC_LISTING_WHERE } });
    if (!listing || !await isAssetAvailable(tx, listing)) throw notFound();
    if (!isBookableCategory(listing.category)) {
      throw new AppError("LISTING_NOT_BOOKABLE", 422, "This property takes enquiries, not stay bookings.");
    }
    if (listing.maxGuests != null && guests > listing.maxGuests) throw invalidStay(`This property hosts up to ${listing.maxGuests} guests.`);
    if (listing.minimumNights != null && nights < listing.minimumNights) throw invalidStay(`This property has a ${listing.minimumNights}-night minimum stay.`);

    const booking = await tx.accommodationBooking.create({
      data: {
        reference: newReference(),
        // Always the listing's own organisation: the one party this request is for.
        organisationId: listing.organisationId,
        listingId,
        userId,
        accommodationType: listing.category,
        checkIn,
        checkOut,
        nights,
        adults: data.adults,
        children: data.children,
        guestName: data.name,
        guestEmail: data.email.toLowerCase(),
        guestPhone: data.phone,
        specialRequest: data.specialRequest,
        nightlyPriceMinor: listing.frequency === "PER_NIGHT" ? listing.rentAmountMinor : null,
        currencyCode: listing.currencyCode,
        idempotencyKeyHash: options.submission?.keyHash,
        idempotencyFingerprint: options.submission?.fingerprint,
      },
    });
    // No guest contact details or message in audit/event payloads.
    await record(tx, listing.organisationId, userId, "accommodation_booking.requested", "accommodation_booking", booking.id, {
      listingId,
      accommodationType: listing.category,
      nights,
      guests,
      authenticated: Boolean(userId),
    });
    return { booking, listingTitle: listing.title, recipientUserId: listing.createdByUserId };
  }).catch((error: unknown) => {
    // The 6-character reference collided (vanishingly rare): let the caller's retry try again.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? "").includes("reference")) {
      throw new AppError("BOOKING_RETRY", 503, "Please try sending your booking request again.");
    }
    throw error;
  });

  const details = emailDetails(created.booking, created.listingTitle);
  await enqueueBookingRequestedEmail(created.recipientUserId, details);
  await enqueueGuestBookingEmail("ACCOMMODATION_BOOKING_RECEIPT", details);
  return publicBookingView(created.booking, created.listingTitle);
}

/** A retried submission (same `Idempotency-Key`) returns the booking it already created. */
export async function findBookingForSubmission(listingId: string, submission: SubmissionBinding) {
  const booking = await db.accommodationBooking.findUnique({
    where: { listingId_idempotencyKeyHash: { listingId, idempotencyKeyHash: submission.keyHash } },
    include: { listing: { select: { title: true } } },
  });
  if (!booking) return null;
  if (booking.idempotencyFingerprint !== submission.fingerprint) {
    throw new AppError("IDEMPOTENCY_KEY_REUSED", 422, "This Idempotency-Key was already used for a different request.");
  }
  return publicBookingView(booking, booking.listing.title);
}

const operatorInclude = { listing: { select: { id: true, title: true, category: true, city: true, marketplaceProfessionalId: true } } } satisfies Prisma.AccommodationBookingInclude;

/** Everything the receiving operator needs to act on a request. */
function operatorBookingView(booking: Prisma.AccommodationBookingGetPayload<{ include: typeof operatorInclude }>) {
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    accommodationType: booking.accommodationType,
    listing: { id: booking.listing.id, title: booking.listing.title, city: booking.listing.city },
    checkIn: booking.checkIn.toISOString().slice(0, 10),
    checkOut: booking.checkOut.toISOString().slice(0, 10),
    nights: booking.nights,
    adults: booking.adults,
    children: booking.children,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone,
    specialRequest: booking.specialRequest,
    nightlyPriceMinor: booking.nightlyPriceMinor?.toString() ?? null,
    currencyCode: booking.currencyCode,
    respondedAt: booking.respondedAt,
    createdAt: booking.createdAt,
  };
}

async function listBookings(where: Prisma.AccommodationBookingWhereInput, query: unknown) {
  const filters = accommodationBookingListSchema.parse(query);
  const scoped: Prisma.AccommodationBookingWhereInput = {
    ...where,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.listingId ? { listingId: filters.listingId } : {}),
  };
  const [items, total] = await db.$transaction([
    db.accommodationBooking.findMany({
      where: scoped,
      include: operatorInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.accommodationBooking.count({ where: scoped }),
  ]);
  return { items: items.map(operatorBookingView), pagination: { page: filters.page, pageSize: filters.pageSize, total } };
}

/** Bookings for the organisation's own listings (Leasing CRM). */
export async function listOrganisationBookings(userId: string, organisationId: string, query: unknown = {}) {
  await requirePropertyOsOrMarketplaceAccess(userId, organisationId, PERMISSIONS.listingLeadRead);
  return listBookings({ organisationId }, query);
}

/** Bookings for listings a marketplace professional markets (their workspace inbox), like leads. */
export async function listProfessionalBookings(userId: string, marketplaceProfessionalId: string, query: unknown = {}) {
  await requireProfessionalInboxAccess(userId, marketplaceProfessionalId);
  return listBookings({ listing: { marketplaceProfessionalId } }, query);
}

/**
 * The caller may act on a booking if they may manage leads of the listing's organisation, or are a
 * member of the professional marketing the listing — the same two parties who receive it.
 */
async function requireBookingManager(userId: string, booking: { organisationId: string; listing: { marketplaceProfessionalId: string | null } }) {
  try {
    await requirePropertyOsOrMarketplaceAccess(userId, booking.organisationId, PERMISSIONS.listingLeadManage);
    return;
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 403) throw error;
  }
  if (booking.listing.marketplaceProfessionalId) {
    await requireProfessionalInboxAccess(userId, booking.listing.marketplaceProfessionalId);
    return;
  }
  throw forbidden();
}

const ALLOWED_TRANSITIONS: Record<AccommodationBookingStatus, AccommodationBookingStatus[]> = {
  REQUESTED: ["CONFIRMED", "DECLINED", "CANCELLED"],
  CONFIRMED: ["CANCELLED"],
  DECLINED: [],
  CANCELLED: [],
};

const GUEST_TEMPLATE = {
  CONFIRMED: "ACCOMMODATION_BOOKING_CONFIRMED",
  DECLINED: "ACCOMMODATION_BOOKING_DECLINED",
  CANCELLED: "ACCOMMODATION_BOOKING_CANCELLED",
} as const;

/**
 * Confirm, decline or cancel. Repeating the current status is a no-op (idempotent; no second
 * email). The change is conditional on the status it was checked against, so two operators acting
 * at once can't both apply conflicting decisions.
 */
export async function updateAccommodationBookingStatus(userId: string, bookingId: string, input: unknown) {
  const { status } = updateAccommodationBookingStatusSchema.parse(input);
  const booking = await db.accommodationBooking.findUnique({ where: { id: listingIdSchema.parse(bookingId) }, include: operatorInclude });
  if (!booking) throw notFound();
  await requireBookingManager(userId, booking);
  if (booking.status === status) return operatorBookingView(booking);
  if (!ALLOWED_TRANSITIONS[booking.status].includes(status)) {
    throw new AppError("INVALID_BOOKING_TRANSITION", 409, `A ${booking.status.toLowerCase()} booking can't be ${status.toLowerCase()}.`);
  }
  const updated = await db.$transaction(async (tx) => {
    const changed = await tx.accommodationBooking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { status, respondedAt: new Date(), respondedByUserId: userId },
    });
    if (changed.count !== 1) throw new AppError("BOOKING_CHANGED", 409, "This booking was just updated. Reload and try again.");
    await record(tx, booking.organisationId, userId, "accommodation_booking.status_changed", "accommodation_booking", booking.id, { fromStatus: booking.status, toStatus: status });
    return tx.accommodationBooking.findUniqueOrThrow({ where: { id: booking.id }, include: operatorInclude });
  });
  await enqueueGuestBookingEmail(GUEST_TEMPLATE[status], emailDetails(updated, updated.listing.title));
  return operatorBookingView(updated);
}
