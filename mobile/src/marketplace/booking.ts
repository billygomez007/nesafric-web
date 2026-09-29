import type { BookingInput, PublicListing } from "@/api/types";

import { MAX_BOOKING_LEAD_DAYS, MAX_GUESTS, MAX_STAY_NIGHTS } from "./listing-categories";

/**
 * Booking-request helpers for hotels and short stays. Dates are calendar days ("2026-10-14"), the
 * same form the server takes; the server checks everything again and decides who receives it.
 */
const DAY_MS = 86_400_000;

export type BookingForm = {
  checkIn: string | null;
  nights: number;
  adults: number;
  children: number;
  name: string;
  email: string;
  phone: string;
  specialRequest: string;
};

export type BookingErrors = Partial<Record<"checkIn" | "nights" | "guests" | "name" | "email" | "phone" | "specialRequest", string>>;

export const isoDay = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);

export function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** The next `count` check-in days, starting today (device's local date). */
export function upcomingDays(today: Date, count = 60) {
  const first = isoDay(today);
  return Array.from({ length: Math.min(count, MAX_BOOKING_LEAD_DAYS) }, (_, index) => {
    const key = addDays(first, index);
    const date = new Date(`${key}T00:00:00Z`);
    return {
      key,
      weekday: date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      day: date.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" }),
      month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
    };
  });
}

export function stayLimits(listing: Pick<PublicListing, "stay">) {
  return {
    maxGuests: listing.stay?.maxGuests ?? MAX_GUESTS,
    minimumNights: Math.max(1, listing.stay?.minimumNights ?? 1),
    maxNights: MAX_STAY_NIGHTS,
  };
}

export function emptyBooking(listing: Pick<PublicListing, "stay">): BookingForm {
  return { checkIn: null, nights: stayLimits(listing).minimumNights, adults: 1, children: 0, name: "", email: "", phone: "", specialRequest: "" };
}

export function validateBooking(form: BookingForm, listing: Pick<PublicListing, "stay">): BookingErrors {
  const limits = stayLimits(listing);
  const errors: BookingErrors = {};
  if (!form.checkIn) errors.checkIn = "Choose a check-in day.";
  if (form.nights < limits.minimumNights) errors.nights = `This property has a ${limits.minimumNights}-night minimum stay.`;
  if (form.nights > limits.maxNights) errors.nights = `A stay request can be at most ${limits.maxNights} nights.`;
  if (form.adults < 1) errors.guests = "At least one adult.";
  else if (form.adults + form.children > limits.maxGuests) errors.guests = `This property hosts up to ${limits.maxGuests} guests.`;
  if (form.name.trim().length < 2) errors.name = "Enter your full name.";
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = "Enter an email address so the property can reply.";
  if (form.phone.trim() && form.phone.trim().length < 5) errors.phone = "Enter a full phone number, or leave it empty.";
  if (form.specialRequest.length > 1000) errors.specialRequest = "Keep special requests under 1,000 characters.";
  return errors;
}

export function toBookingInput(form: BookingForm): BookingInput {
  return {
    checkIn: form.checkIn!,
    checkOut: addDays(form.checkIn!, form.nights),
    adults: form.adults,
    children: form.children,
    name: form.name.trim(),
    email: form.email.trim(),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    ...(form.specialRequest.trim() ? { specialRequest: form.specialRequest.trim() } : {}),
  };
}

export const guestsLabel = (adults: number, children: number) =>
  [`${adults} adult${adults === 1 ? "" : "s"}`, ...(children ? [`${children} child${children === 1 ? "" : "ren"}`] : [])].join(", ");
