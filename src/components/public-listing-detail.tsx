"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { PublicListing } from "@/components/property-marketplace-search";
import { categorical, compactParams, trackEvent } from "@/platform/analytics";

function listingEventParams(listing: PublicListing) {
  return compactParams({
    property_type: categorical(listing.category),
    transaction_type: categorical(listing.listingType),
    region: categorical(listing.location.region),
    city: categorical(listing.location.city),
  });
}

export function PublicListingDetail({ listingId }: { listingId: string }) {
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    fetch(`/api/public/listings/${listingId}`).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "This listing is unavailable.");
      const loaded = (await response.json()).listing as PublicListing;
      setListing(loaded);
      trackEvent("property_view", listingEventParams(loaded));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load listing."));
  }, [listingId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !listing) return;
    // Captured now, not read from `event.currentTarget` after the awaits below — a native event's
    // `currentTarget` reverts to null once synchronous dispatch finishes, i.e. at the first `await`.
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("requestViewing") === "on" && (!data.get("startsAt") || !data.get("endsAt"))) {
      setError("Choose both a preferred start and end time for the viewing.");
      return;
    }
    setSubmitting(true);
    try {
      const leadResponse = await fetch(`/api/public/listings/${listingId}/leads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), email: data.get("email") || undefined, phone: data.get("phone") || undefined, message: data.get("message") || undefined, source: "PROPERTY_MARKETPLACE", marketingConsent: data.get("marketingConsent") === "on" }) });
      if (!leadResponse.ok) return setError((await leadResponse.json()).error?.message ?? "Unable to send enquiry.");
      const lead = await leadResponse.json();
      const requestedViewing = data.get("requestViewing") === "on";
      if (requestedViewing) {
        const viewingResponse = await fetch(`/api/public/listings/${listingId}/viewings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: lead.id, preferredTimes: [{ startsAt: data.get("startsAt"), endsAt: data.get("endsAt"), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }], requesterNote: data.get("message") || undefined }) });
        if (!viewingResponse.ok) return setError((await viewingResponse.json()).error?.message ?? "Enquiry sent, but viewing request failed.");
      }
      form.reset(); setError(""); setSuccess(requestedViewing ? "Enquiry and viewing request sent." : "Enquiry sent.");
      trackEvent("property_enquiry", { ...listingEventParams(listing), requested_viewing: requestedViewing });
    } finally {
      setSubmitting(false);
    }
  }
  if (error && !listing) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  if (!listing) return <p className="rounded-xl border bg-white p-6 text-slate-500">Loading listing...</p>;
  const amount = listing.pricing.rentAmountMinor ?? listing.pricing.askingAmountMinor;
  return <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><div className="grid content-start gap-6"><section className="overflow-hidden rounded-2xl border bg-white shadow-sm">{listing.media.length ? <div className="grid gap-1 sm:grid-cols-2">{listing.media.slice(0, 4).map((media, index) => <div aria-label={media.altText ?? media.title ?? listing.title} className={`${index === 0 ? "h-80 sm:col-span-2" : "h-48"} bg-slate-100 bg-cover bg-center`} key={media.id} role="img" style={{ backgroundImage: media.type === "PHOTO" ? `url("${media.url}")` : undefined }}><span className="m-3 inline-block rounded bg-black/60 px-2 py-1 text-xs text-white">{media.type.replace("_", " ")}</span></div>)}</div> : <div className="flex h-72 items-center justify-center bg-slate-100 text-slate-500">No photos available</div>}<div className="p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-navy">{listing.listingType} · {listing.scope} · {listing.category}</p><h1 className="mt-1 text-3xl font-semibold">{listing.title}</h1><p className="mt-2 text-slate-500">{listing.location.label || [listing.location.locality, listing.location.district, listing.location.city, listing.location.region, listing.location.countryCode].filter(Boolean).join(", ")}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${listing.verification.status === "VERIFIED" ? "bg-premium/15 text-navy" : "bg-slate-100 text-slate-700"}`}>{listing.verification.status}</span></div><p className="mt-5 text-3xl font-semibold">{amount ? money(amount, listing.pricing.currencyCode) : "Contact for price"}{listing.pricing.frequency && <span className="text-base font-normal text-slate-500"> / {listing.pricing.frequency.toLowerCase()}</span>}</p><p className="mt-5 whitespace-pre-wrap leading-7 text-slate-700">{listing.description}</p></div></section><section className="grid gap-4 sm:grid-cols-4">{[["Bedrooms", listing.attributes.bedrooms ?? "—"], ["Bathrooms", listing.attributes.bathrooms ?? "—"], ["Size", listing.attributes.sizeSqm ? `${listing.attributes.sizeSqm} m²` : "—"], ["Available", new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(listing.availability.availableFrom))]].map(([label, value]) => <div className="rounded-2xl border bg-white p-5 shadow-sm" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>)}</section><section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Amenities</h2>{listing.amenities.length ? <div className="mt-4 flex flex-wrap gap-2">{listing.amenities.map((amenity) => <span className="rounded-full bg-slate-100 px-3 py-2 text-sm" key={amenity.key}>{amenity.label}</span>)}</div> : <p className="mt-3 text-slate-500">No amenities listed.</p>}</section><section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Location</h2><p className="mt-2 text-slate-600">{[listing.location.countryCode, listing.location.region, listing.location.city, listing.location.district, listing.location.locality].filter(Boolean).join(" · ")}</p><div className="mt-4 flex h-40 items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500">{listing.location.map.latitude ? `Map-ready coordinates (${listing.location.map.precision?.toLowerCase()})` : "Geocoding/map integration ready"}</div></section></div><aside className="grid content-start gap-4">{listing.attribution.professional && <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Listed by</p><Link className="mt-2 block text-lg font-semibold text-slate-950 hover:text-brand-strong" href={`/marketplace/professionals/${listing.attribution.professional.slug}`}>{listing.attribution.professional.displayName}</Link><p className="mt-1 text-sm text-slate-500">{listing.attribution.listedBy}{listing.attribution.professional.verificationStatus === "VERIFIED" ? " · Verified" : ""}</p></div>}{listing.contact.enquiryEnabled ? <form aria-label="Enquire about this listing" className="grid gap-4 rounded-2xl border bg-white p-5 shadow-sm" onSubmit={submit}><div><h2 className="text-xl font-semibold">Enquire about this listing</h2><p className="mt-1 text-sm text-slate-500">This creates a marketplace lead, not a tenant record.</p></div><input aria-label="Your name" className="rounded-lg border p-3" name="name" placeholder="Your name" required /><input aria-label="Email" className="rounded-lg border p-3" name="email" placeholder="Email" type="email" /><input aria-label="Phone" className="rounded-lg border p-3" name="phone" placeholder="Phone" /><textarea aria-label="Your message" className="rounded-lg border p-3" name="message" placeholder="Your message" rows={4} /><label className="flex items-center gap-2 text-sm"><input name="requestViewing" type="checkbox" />Request a viewing</label><div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">Preferred start<input className="mt-1 w-full rounded-lg border p-2 text-sm" name="startsAt" type="datetime-local" /></label><label className="text-xs text-slate-500">Preferred end<input className="mt-1 w-full rounded-lg border p-2 text-sm" name="endsAt" type="datetime-local" /></label></div><label className="flex items-start gap-2 text-xs text-slate-500"><input className="mt-0.5" name="marketingConsent" type="checkbox" />I consent to relevant follow-up communication.</label><button className="rounded-lg bg-brand p-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting}>{submitting ? "Sending…" : "Send request"}</button>{success && <p className="rounded-lg bg-success/10 p-3 text-sm text-success">{success}</p>}{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{(listing.contact.email || listing.contact.phone) && <p className="text-center text-sm text-slate-500">{listing.contact.email || listing.contact.phone}</p>}</form> : <p className="rounded-xl border bg-white p-5 text-slate-500">Enquiries are currently disabled.</p>}</aside></div>;
}
function money(value: string, currency: string) { return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value) / 100); }
