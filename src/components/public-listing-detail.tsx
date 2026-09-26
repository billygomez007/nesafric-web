"use client";

import Link from "next/link";
import { photosCoverFirst } from "@/lib/listing-cover";
import { FormEvent, useEffect, useState } from "react";
import type { PublicListing } from "@/components/property-marketplace-search";
import { ErrorState, Skeleton, SuccessNotice } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button-styles";
import { formatListingPrice, frequencySuffix, humanize, listingLocation, listingTypeLabel, specLine } from "@/lib/listing-display";
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
  // Captured once so "Available now" is stable across re-renders.
  const [now] = useState(() => Date.now());
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
  if (error && !listing) return <ErrorState message={error} title="This listing can't be shown" />;
  if (!listing) {
    return (
      <div aria-busy="true" className="grid gap-6" role="status">
        <span className="sr-only">Loading listing</span>
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }
  const amount = listing.pricing.rentAmountMinor ?? listing.pricing.askingAmountMinor;
  const suffix = listing.listingType === "RENT" ? frequencySuffix(listing.pricing.frequency) : "";
  const photos = photosCoverFirst(listing.media);
  const floorPlans = listing.media.filter((media) => media.type === "FLOOR_PLAN");
  const videos = listing.media.filter((media) => media.type === "VIDEO");
  const [cover, ...morePhotos] = photos;
  const specs = specLine(listing.attributes);
  const verified = listing.verification.status === "VERIFIED";
  const place = [listing.location.locality, listing.location.district, listing.location.city, listing.location.region].filter(Boolean).join(", ");
  const { latitude, longitude } = listing.location.map;
  const available = new Date(listing.availability.availableFrom);
  const availableLabel = available.getTime() <= now ? "Available now" : `Available from ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(available)}`;
  const facts: Array<[string, string]> = [
    ["Type", `${humanize(listing.category)}${listing.scope === "UNIT" ? " (unit)" : ""}`],
    ...(listing.attributes.bedrooms !== null ? [["Bedrooms", listing.attributes.bedrooms === 0 ? "Studio" : String(listing.attributes.bedrooms)] as [string, string]] : []),
    ...(listing.attributes.bathrooms ? [["Bathrooms", String(Number(listing.attributes.bathrooms))] as [string, string]] : []),
    ...(listing.attributes.sizeSqm ? [["Floor area", `${Number(listing.attributes.sizeSqm).toLocaleString("en")} m²`] as [string, string]] : []),
    ["Availability", availableLabel],
  ];
  const fieldClass = "h-11 w-full rounded-[var(--radius-control)] border border-hairline bg-white px-3 text-sm text-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/10";

  return (
    <div className="pb-24 lg:pb-0">
      {/* Gallery: one cover photograph, then the rest of the set. */}
      {cover ? (
        <section aria-label="Photos" className="grid gap-2 lg:grid-cols-[2fr_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL */}
          <img alt={cover.altText ?? cover.title ?? listing.title} className="aspect-[4/3] w-full rounded-[var(--radius-media)] bg-cream object-cover lg:aspect-auto lg:h-full lg:max-h-[560px]" src={cover.url} />
          {morePhotos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-2 lg:content-start">
              {morePhotos.map((media) => (
                // eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL
                <img alt={media.altText ?? media.title ?? listing.title} className="aspect-[4/3] w-full rounded-[var(--radius-media)] bg-cream object-cover" decoding="async" key={media.id} loading="lazy" src={media.url} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="flex aspect-[16/7] items-center justify-center rounded-[var(--radius-media)] bg-cream text-sm text-muted">Photos coming soon</div>
      )}
      {photos.length > 1 && <p className="mt-2 text-xs text-muted">{photos.length} photos</p>}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <header>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span className="font-semibold text-forest">{listingTypeLabel(listing.listingType)}</span>
              {verified && (
                <span className="inline-flex items-center gap-1 font-semibold text-gold-ink">
                  <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
                  Verified listing
                </span>
              )}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-4xl">{listing.title}</h1>
            <p className="mt-2 text-base text-muted">{listingLocation(listing.location)}</p>
            <p className="mt-5 text-3xl font-semibold tracking-[-0.01em] text-forest-deep tabular-nums" data-money>
              {amount ? formatListingPrice(amount, listing.pricing.currencyCode) : "Price on request"}
              {amount && suffix && <span className="text-base font-normal text-muted"> / {suffix}</span>}
            </p>
            {specs.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-x-3 text-sm text-slate-600">{specs.map((part) => <span key={part}>{part}</span>)}</p>
            )}
          </header>

          <dl className="mt-8 grid grid-cols-2 border-t border-hairline sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div className="border-b border-hairline py-4 pr-4" key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-[15px] font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {listing.description && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold text-forest-deep">About this property</h2>
              <p className="mt-3 max-w-[68ch] whitespace-pre-wrap text-[15px] leading-7 text-ink">{listing.description}</p>
            </section>
          )}

          {listing.amenities.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold text-forest-deep">Amenities</h2>
              <ul className="mt-4 grid gap-x-6 gap-y-2 text-[15px] text-ink sm:grid-cols-2">
                {listing.amenities.map((amenity) => (
                  <li className="flex items-center gap-2.5" key={amenity.key}>
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    {amenity.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(floorPlans.length > 0 || videos.length > 0) && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold text-forest-deep">Floor plans and video</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {floorPlans.map((media) => (
                  <a className="group block" href={media.url} key={media.id} rel="noopener noreferrer" target="_blank">
                    {/* eslint-disable-next-line @next/next/no-img-element -- listing media is served from the storage provider's public URL */}
                    <img alt={media.altText ?? media.title ?? "Floor plan"} className="aspect-[4/3] w-full rounded-[var(--radius-media)] border border-hairline bg-white object-contain" loading="lazy" src={media.url} />
                    <span className="mt-2 block text-sm font-semibold text-forest group-hover:underline">{media.title ?? "Floor plan"}</span>
                  </a>
                ))}
                {videos.map((media) => (
                  <a className="flex min-h-11 items-center gap-2 text-sm font-semibold text-forest hover:underline" href={media.url} key={media.id} rel="noopener noreferrer" target="_blank">
                    Watch video{media.title ? `: ${media.title}` : ""} <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="mt-10 border-t border-hairline pt-8">
            <h2 className="text-xl font-semibold text-forest-deep">Location</h2>
            <p className="mt-2 text-[15px] text-ink">{place || listingLocation(listing.location)}</p>
            <p className="mt-1 text-sm text-muted">The exact address is shared by the lister when you arrange a viewing.</p>
            {latitude && longitude && (
              <a
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest hover:underline"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                View the area on Google Maps <span aria-hidden="true">↗</span>
              </a>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6 lg:sticky lg:top-24">
          {listing.attribution.professional && (
            <div className="border-t-2 border-forest pt-4">
              <p className="text-xs text-muted">Listed by</p>
              <Link className="mt-1 block text-lg font-semibold text-forest-deep hover:text-forest hover:underline" href={`/marketplace/professionals/${listing.attribution.professional.slug}`}>
                {listing.attribution.professional.displayName}
              </Link>
              <p className="mt-0.5 text-sm text-muted">
                {listing.attribution.listedBy}
                {listing.attribution.professional.verificationStatus === "VERIFIED" && <span className="font-semibold text-gold-ink"> · Verified professional</span>}
              </p>
            </div>
          )}

          {listing.contact.enquiryEnabled ? (
            <form aria-label="Enquire about this listing" className="grid scroll-mt-24 gap-3 rounded-[var(--radius-panel)] border border-hairline bg-white p-5" id="enquire" onSubmit={submit}>
              <div>
                <h2 className="text-lg font-semibold text-forest-deep">Ask about this property</h2>
                <p className="mt-1 text-sm text-muted">Your details go only to the lister, who will reply by email or phone.</p>
              </div>
              <label className="grid gap-1.5 text-xs font-medium text-muted">Your name<input autoComplete="name" className={fieldClass} name="name" required /></label>
              <label className="grid gap-1.5 text-xs font-medium text-muted">Email<input autoComplete="email" className={fieldClass} name="email" type="email" /></label>
              <label className="grid gap-1.5 text-xs font-medium text-muted">Phone<input autoComplete="tel" className={fieldClass} inputMode="tel" name="phone" placeholder="+233" type="tel" /></label>
              <label className="grid gap-1.5 text-xs font-medium text-muted">Message<textarea className="w-full rounded-[var(--radius-control)] border border-hairline bg-white p-3 text-sm text-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/10" name="message" rows={4} /></label>
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink"><input className="h-4 w-4 accent-forest" name="requestViewing" type="checkbox" />I&apos;d like to arrange a viewing</label>
              <div className="grid gap-3">
                <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">Preferred start<input className={`${fieldClass} min-w-0`} name="startsAt" type="datetime-local" /></label>
                <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">Preferred end<input className={`${fieldClass} min-w-0`} name="endsAt" type="datetime-local" /></label>
              </div>
              <label className="flex items-start gap-2.5 text-xs leading-5 text-muted"><input className="mt-0.5 h-4 w-4 accent-forest" name="marketingConsent" type="checkbox" />The lister may contact me about similar properties.</label>
              <button className={`${buttonClass("primary")} w-full`} disabled={submitting} type="submit">{submitting ? "Sending…" : "Send request"}</button>
              {success && <SuccessNotice>{success}</SuccessNotice>}
              {error && <ErrorState message={error} title="Your enquiry wasn't sent" />}
              {(listing.contact.email || listing.contact.phone) && (
                <p className="text-center text-sm text-muted">
                  Or contact directly:{" "}
                  {listing.contact.phone ? <a className="font-semibold text-forest hover:underline" href={`tel:${listing.contact.phone}`}>{listing.contact.phone}</a> : <a className="font-semibold text-forest hover:underline" href={`mailto:${listing.contact.email}`}>{listing.contact.email}</a>}
                </p>
              )}
            </form>
          ) : (
            <p className="border-t border-hairline pt-4 text-sm text-muted">The lister isn&apos;t taking enquiries through NesAfric for this property right now.</p>
          )}
        </aside>
      </div>

      {listing.contact.enquiryEnabled && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-hairline bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <p className="min-w-0 truncate text-base font-semibold text-forest-deep tabular-nums">
            {amount ? formatListingPrice(amount, listing.pricing.currencyCode) : "Price on request"}
            {amount && suffix && <span className="text-sm font-normal text-muted"> / {suffix}</span>}
          </p>
          <a className={buttonClass("primary", "sm")} href="#enquire">Enquire</a>
        </div>
      )}
    </div>
  );
}
