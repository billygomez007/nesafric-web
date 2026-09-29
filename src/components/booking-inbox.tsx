"use client";

import { useCallback, useEffect, useState } from "react";

import { buttonClass } from "@/components/ui/button-styles";
import { formatListingPrice } from "@/lib/listing-display";
import { trackEvent } from "@/platform/analytics";

type Booking = {
  id: string;
  reference: string;
  status: "REQUESTED" | "CONFIRMED" | "DECLINED" | "CANCELLED";
  accommodationType: string;
  listing: { id: string; title: string; city: string | null };
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  specialRequest: string | null;
  nightlyPriceMinor: string | null;
  currencyCode: string;
  createdAt: string;
};

type Source = { kind: "organisation" } | { kind: "professional"; professionalId: string };

const TABS = [
  ["REQUESTED", "New"],
  ["CONFIRMED", "Confirmed"],
  ["DECLINED", "Declined"],
  ["CANCELLED", "Cancelled"],
] as const;

const date = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const received = (value: string) => new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Hotel and short-stay booking requests for an operator: the organisation's own listings (Leasing
 * CRM) or a professional's marketed listings (their workspace). The server decides what's listed
 * and who may confirm or decline; this only shows it.
 */
export function BookingInbox({ source }: { source: Source }) {
  const [tab, setTab] = useState<Booking["status"]>("REQUESTED");
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Primitive dependencies: `source` is a new object on every render.
  const professionalId = source.kind === "professional" ? source.professionalId : null;
  const load = useCallback(async () => {
    setError("");
    const organisationId = professionalId ? null : localStorage.getItem("propertyos.activeOrganisationId");
    if (!professionalId && !organisationId) return setError("Choose an organisation.");
    const url = professionalId
      ? `/api/marketplace-professionals/${professionalId}/bookings?status=${tab}&pageSize=100`
      : `/api/accommodation-bookings?status=${tab}&pageSize=100`;
    try {
      const response = await fetch(url, { headers: organisationId ? { "x-organisation-id": organisationId } : {} });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to load bookings.");
      setBookings(body.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load bookings.");
    }
  }, [professionalId, tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)loads the list when the tab changes
    void load();
  }, [load]);

  async function decide(booking: Booking, status: "CONFIRMED" | "DECLINED" | "CANCELLED") {
    setBusyId(booking.id);
    setError("");
    try {
      const response = await fetch(`/api/accommodation-bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to update this booking.");
      if (status === "CONFIRMED") trackEvent("accommodation_booking_confirmed", { property_type: booking.accommodationType.toLowerCase() });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update this booking.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Bookings</h2>
          <p className="mt-1 text-sm text-muted">Stay requests for your hotels and short stays. Nothing is confirmed until you confirm it.</p>
        </div>
        <div aria-label="Booking status" className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map(([value, label]) => (
            <button
              aria-selected={tab === value}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${tab === value ? "border-forest bg-forest text-white" : "border-hairline text-muted hover:bg-surface"}`}
              key={value}
              onClick={() => setTab(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p>}
      {!bookings && !error && <p className="mt-5 text-muted">Loading bookings…</p>}
      {bookings && !bookings.length && <p className="mt-5 rounded-xl border border-dashed border-hairline p-8 text-center text-muted">No {TABS.find(([value]) => value === tab)?.[1].toLowerCase()} bookings.</p>}
      {bookings && bookings.length > 0 && (
        <ul className="mt-5 grid gap-3">
          {bookings.map((booking) => (
            <li className="rounded-xl border border-hairline p-4" data-testid={`booking-${booking.reference}`} key={booking.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-teal">{booking.listing.title}{booking.listing.city ? ` · ${booking.listing.city}` : ""}</p>
                  <h3 className="mt-1 font-semibold">{booking.guestName}</h3>
                  <p className="text-sm text-muted">
                    <a className="hover:underline" href={`mailto:${booking.guestEmail}`}>{booking.guestEmail}</a>
                    {booking.guestPhone ? <> · <a className="hover:underline" href={`tel:${booking.guestPhone}`}>{booking.guestPhone}</a></> : null}
                  </p>
                </div>
                <span className="rounded-full bg-surface px-2 py-1 font-mono text-xs font-semibold">{booking.reference}</span>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">Check-in</dt><dd>{date(booking.checkIn)}</dd></div>
                <div><dt className="text-xs text-muted">Check-out</dt><dd>{date(booking.checkOut)}</dd></div>
                <div><dt className="text-xs text-muted">Nights · guests</dt><dd>{booking.nights} · {booking.adults + booking.children} ({booking.adults} adult{booking.adults === 1 ? "" : "s"}{booking.children ? `, ${booking.children} child${booking.children === 1 ? "" : "ren"}` : ""})</dd></div>
                <div><dt className="text-xs text-muted">Received</dt><dd>{received(booking.createdAt)}</dd></div>
              </dl>
              {booking.nightlyPriceMinor && <p className="mt-2 text-xs text-muted">Listed at {formatListingPrice(booking.nightlyPriceMinor, booking.currencyCode)} / night when requested.</p>}
              {booking.specialRequest && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 text-sm">{booking.specialRequest}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {booking.status === "REQUESTED" && (
                  <>
                    <button className={buttonClass("primary", "sm")} disabled={busyId === booking.id} onClick={() => void decide(booking, "CONFIRMED")} type="button">Confirm</button>
                    <button className={buttonClass("secondary", "sm")} disabled={busyId === booking.id} onClick={() => void decide(booking, "DECLINED")} type="button">Decline</button>
                  </>
                )}
                {booking.status === "CONFIRMED" && (
                  <button className={buttonClass("secondary", "sm")} disabled={busyId === booking.id} onClick={() => void decide(booking, "CANCELLED")} type="button">Cancel booking</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
