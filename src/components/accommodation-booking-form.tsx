"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

import type { PublicListing } from "@/components/property-marketplace-search";
import { buttonClass } from "@/components/ui/button-styles";
import { ErrorState } from "@/components/ui/states";
import { idempotencyKeyFor, type IdempotencySlot } from "@/lib/idempotency-key";
import { ACCOMMODATION_CATEGORY_LABELS, isBookableCategory, MAX_GUESTS } from "@/lib/listing-categories";
import { formatListingPrice } from "@/lib/listing-display";
import { categorical, compactParams, trackEvent } from "@/platform/analytics";

type BookingResult = { reference: string; listingTitle: string; checkIn: string; checkOut: string; nights: number; adults: number; children: number; status: string };

const fieldClass = "min-h-11 w-full rounded-[var(--radius-control)] border border-hairline bg-white px-3 text-sm text-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/10";
const DAY_MS = 86_400_000;
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const guestsLabel = (adults: number, children: number) => [`${adults} adult${adults === 1 ? "" : "s"}`, ...(children ? [`${children} child${children === 1 ? "" : "ren"}`] : [])].join(", ");

/**
 * The booking request for a hotel or short stay. The server checks everything again (dates,
 * guests, minimum stay) and decides who receives it; this form only helps the guest get it right.
 * Nothing is confirmed here: the success message says the request was sent to the property.
 */
export function AccommodationBookingForm({ listing }: { listing: PublicListing }) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BookingResult | null>(null);
  const started = useRef(false);
  const bookingKey = useRef<IdempotencySlot>(null);
  const [today] = useState(() => isoDate(Date.now()));

  const maxGuests = listing.stay?.maxGuests ?? MAX_GUESTS;
  const minimumNights = listing.stay?.minimumNights ?? 1;
  const nightly = listing.pricing.frequency === "PER_NIGHT" ? listing.pricing.rentAmountMinor : null;
  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / DAY_MS);
  }, [checkIn, checkOut]);
  const earliestCheckOut = checkIn ? isoDate(Date.parse(`${checkIn}T00:00:00Z`) + minimumNights * DAY_MS) : today;
  const label = isBookableCategory(listing.category) ? ACCOMMODATION_CATEGORY_LABELS[listing.category] : "stay";

  function markStarted() {
    if (started.current) return;
    started.current = true;
    trackEvent("accommodation_booking_started", compactParams({ property_type: categorical(listing.category), city: categorical(listing.location.city) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    const adults = Number(data.get("adults"));
    const children = Number(data.get("children") || 0);
    if (nights < minimumNights) return setError(minimumNights > 1 ? `Choose at least ${minimumNights} nights.` : "Check-out must be after check-in.");
    if (adults + children > maxGuests) return setError(`This ${label.toLowerCase()} hosts up to ${maxGuests} guests.`);
    setError("");
    setSubmitting(true);
    try {
      const body = JSON.stringify({
        checkIn, checkOut, adults, children,
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        phone: String(data.get("phone") ?? "") || undefined,
        specialRequest: String(data.get("specialRequest") ?? "") || undefined,
      });
      const response = await fetch(`/api/public/listings/${listing.id}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKeyFor(bookingKey, body) },
        body,
      });
      const json = await response.json();
      if (!response.ok) return setError(json.error?.message ?? "Your booking request wasn't sent. Please try again.");
      bookingKey.current = null;
      setResult(json as BookingResult);
      // No names, contact details or messages in analytics.
      trackEvent("accommodation_booking_submitted", compactParams({ property_type: categorical(listing.category), city: categorical(listing.location.city), nights }));
    } catch {
      setError("Your booking request wasn't sent. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <section aria-live="polite" className="grid gap-3 rounded-[var(--radius-panel)] border border-hairline bg-white p-5" data-testid="booking-sent" id="book">
        <h2 className="text-lg font-semibold text-forest-deep">Booking request sent</h2>
        <p className="text-sm text-muted">Your booking request has been sent to the property. It isn&apos;t confirmed yet: {result.listingTitle} will confirm or decline it, and we&apos;ll email you.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Property</dt><dd className="font-semibold text-ink">{result.listingTitle}</dd>
          <dt className="text-muted">Check-in</dt><dd>{dateLabel(result.checkIn)}</dd>
          <dt className="text-muted">Check-out</dt><dd>{dateLabel(result.checkOut)}</dd>
          <dt className="text-muted">Guests</dt><dd>{guestsLabel(result.adults, result.children)}</dd>
          <dt className="text-muted">Reference</dt><dd className="font-mono font-semibold">{result.reference}</dd>
        </dl>
      </section>
    );
  }

  return (
    <form aria-label={`Request a booking at this ${label.toLowerCase()}`} className="grid scroll-mt-24 gap-3 rounded-[var(--radius-panel)] border border-hairline bg-white p-5" id="book" onFocus={markStarted} onSubmit={submit}>
      <div>
        <h2 className="text-lg font-semibold text-forest-deep">Request a booking</h2>
        <p className="mt-1 text-sm text-muted">
          {nightly ? <>{listing.category === "HOTEL" ? "From " : ""}<span className="font-semibold text-ink">{formatListingPrice(nightly, listing.pricing.currencyCode)}</span> / night · </> : null}
          Sent to the property, who confirms or declines it.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">Check-in<input className={`${fieldClass} min-w-0`} min={today} name="checkIn" onChange={(event) => setCheckIn(event.target.value)} required type="date" value={checkIn} /></label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">Check-out<input className={`${fieldClass} min-w-0`} min={earliestCheckOut} name="checkOut" onChange={(event) => setCheckOut(event.target.value)} required type="date" value={checkOut} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-xs font-medium text-muted">Adults<input className={fieldClass} defaultValue={1} max={maxGuests} min={1} name="adults" required type="number" /></label>
        <label className="grid gap-1.5 text-xs font-medium text-muted">Children<input className={fieldClass} defaultValue={0} max={maxGuests} min={0} name="children" type="number" /></label>
      </div>
      {nights > 0 && (
        <p className="text-sm text-ink" data-testid="booking-nights">
          {nights} night{nights === 1 ? "" : "s"}
          {nightly ? <> · about {formatListingPrice(String(BigInt(nightly) * BigInt(nights)), listing.pricing.currencyCode)} before any extras</> : null}
        </p>
      )}
      <p className="text-xs text-muted">
        {listing.stay?.maxGuests ? `Up to ${listing.stay.maxGuests} guests. ` : ""}
        {minimumNights > 1 ? `Minimum ${minimumNights} nights. ` : ""}
        {listing.stay?.checkInTime ? `Check-in from ${listing.stay.checkInTime}. ` : ""}
        {listing.stay?.checkOutTime ? `Check-out by ${listing.stay.checkOutTime}.` : ""}
      </p>
      <label className="grid gap-1.5 text-xs font-medium text-muted">Full name<input autoComplete="name" className={fieldClass} maxLength={160} minLength={2} name="name" required /></label>
      <label className="grid gap-1.5 text-xs font-medium text-muted">Email<input autoComplete="email" className={fieldClass} maxLength={320} name="email" required type="email" /></label>
      <label className="grid gap-1.5 text-xs font-medium text-muted">Phone<input autoComplete="tel" className={fieldClass} inputMode="tel" maxLength={50} name="phone" placeholder="+233" type="tel" /></label>
      <label className="grid gap-1.5 text-xs font-medium text-muted">Special requests <span className="font-normal">(optional)</span><textarea className="w-full rounded-[var(--radius-control)] border border-hairline bg-white p-3 text-sm text-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/10" maxLength={1000} name="specialRequest" rows={3} /></label>
      {listing.stay?.houseRules ? <details className="text-xs text-muted"><summary className="cursor-pointer font-semibold text-ink">House rules</summary><p className="mt-1 whitespace-pre-wrap">{listing.stay.houseRules}</p></details> : null}
      <button className={`${buttonClass("primary")} w-full`} disabled={submitting} type="submit">{submitting ? "Sending…" : "Request booking"}</button>
      {error && <ErrorState message={error} title="Your booking request wasn't sent" />}
    </form>
  );
}
