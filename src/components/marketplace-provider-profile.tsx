"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { PublicProvider } from "@/components/marketplace-search";
import {
  AvailabilityBadge,
  completionRatePercent,
  formatServiceArea,
  ProviderLogo,
  providerTypeLabel,
  ratingSummary,
  responseTimeLabel,
  startingRateLabel,
  TrustSummary,
  VerificationBadges,
} from "@/components/marketplace-provider-trust";
import { SaveProviderButton, SavedProvidersProvider, signInHrefForCurrentPage, useSavedProviders } from "@/components/saved-providers";
import { buttonClass } from "@/components/ui/button-styles";
import { categorical, compactParams, trackEvent } from "@/platform/analytics";

type Property = { id: string; name: string; referenceNumber: string };
type Maintenance = { id: string; title: string; property: { id: string; name: string }; status: string };

function providerEventParams(provider: PublicProvider) {
  return compactParams({
    provider_type: categorical(provider.type),
    service_category: categorical(provider.categories[0]?.name),
  });
}

/** Public provider profile. Saved state is loaded once for the page (see `SavedProvidersProvider`). */
export function MarketplaceProviderProfile(props: { providerId?: string; slug?: string }) {
  return <SavedProvidersProvider><ProviderProfile {...props} /></SavedProvidersProvider>;
}

function ProviderProfile({ providerId, slug }: { providerId?: string; slug?: string }) {
  const [provider, setProvider] = useState<PublicProvider | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const endpoint = slug ? `/api/public/marketplace/services/${slug}` : `/api/public/marketplace/providers/${providerId}`;
    fetch(endpoint).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Provider is not publicly listed.");
      const loaded = (await response.json()).provider as PublicProvider;
      setProvider(loaded);
      trackEvent("service_provider_view", providerEventParams(loaded));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load provider."));
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (organisationId) {
      Promise.all([fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId } }), fetch("/api/maintenance/requests", { headers: { "x-organisation-id": organisationId } })]).then(async ([propertyResponse, maintenanceResponse]) => {
        if (propertyResponse.ok) setProperties((await propertyResponse.json()).properties);
        if (maintenanceResponse.ok) setMaintenance(await maintenanceResponse.json());
      });
    }
  }, [providerId, slug]);
  async function enquire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !provider) return;
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Requests are sent from a property management workspace. Open or set up your workspace, then try again.");
    // Captured now, not read from `event.currentTarget` after the awaits below — a native event's
    // `currentTarget` reverts to null once synchronous dispatch finishes, i.e. at the first `await`.
    const form = event.currentTarget;
    const data = new FormData(form);
    const maintenanceRequestId = String(data.get("maintenanceRequestId") || "");
    const selectedMaintenance = maintenance.find((request) => request.id === maintenanceRequestId);
    setSubmitting(true);
    try {
      const response = await fetch("/api/marketplace/enquiries", { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ providerId: provider.id, categoryId: data.get("categoryId"), propertyId: selectedMaintenance?.property.id || data.get("propertyId") || undefined, maintenanceRequestId: maintenanceRequestId || undefined, message: data.get("message") }) });
      if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to send enquiry.");
      const enquiry = await response.json();
      const requestedQuote = data.get("requestQuote") === "on";
      if (requestedQuote) {
        const quoteResponse = await fetch(`/api/marketplace/enquiries/${enquiry.id}/quote-request`, { method: "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify({ scope: data.get("message") }) });
        if (!quoteResponse.ok) return setError((await quoteResponse.json()).error?.message ?? "Enquiry created, but quotation could not be requested.");
      }
      form.reset(); setError(""); setSuccess(requestedQuote ? "Enquiry and quotation request sent." : "Enquiry sent.");
      trackEvent("service_provider_enquiry", { ...providerEventParams(provider), requested_quote: requestedQuote });
    } finally {
      setSubmitting(false);
    }
  }
  if (error && !provider) {
    return <div className="rounded-3xl border border-hairline bg-white p-8" role="alert"><h1 className="text-xl font-semibold text-forest-deep">Provider not available</h1><p className="mt-2 text-muted">This provider isn’t on the NesAfric marketplace right now. Their profile may have been unlisted or is under review.</p><Link className="mt-4 inline-block font-semibold text-teal" href="/marketplace/services">Browse service providers</Link></div>;
  }
  if (!provider) return <p className="rounded-2xl border border-hairline bg-white p-6 text-muted">Loading public provider profile...</p>;
  const type = providerTypeLabel(provider.type);
  const rating = ratingSummary(provider);
  const completion = completionRatePercent(provider);
  const rate = startingRateLabel(provider);
  const response = responseTimeLabel(provider.responseTimeHours);
  const canReceiveWork = provider.verification === "VERIFIED";
  const card = "rounded-3xl border border-hairline bg-white p-6 shadow-sm";
  return <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
    <div className="grid min-w-0 content-start gap-6">
      <section aria-labelledby="provider-name" className={card}>
        <div className="flex flex-wrap items-start gap-4">
          <ProviderLogo name={provider.displayName} size="lg" url={provider.logo?.url} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-teal">{[type, provider.categories[0]?.name].filter(Boolean).join(" · ")}</p>
            <h1 className="mt-1 break-words text-3xl font-semibold text-forest-deep" id="provider-name">{provider.displayName}</h1>
            <div className="mt-2"><AvailabilityBadge provider={provider} /></div>
          </div>
          <div className="flex items-start gap-2">
            <SaveProviderButton name={provider.displayName} providerId={provider.id} variant="full" />
            {canReceiveWork ? <a className={buttonClass("primary")} href="#request-service">Request service</a> : null}
          </div>
        </div>
        <div className="mt-4">
          <VerificationBadges provider={provider} />
        </div>

        <div className="mt-4">
          <TrustSummary provider={provider} />
        </div>
      </section>

      <section aria-labelledby="nesafric-record" className={card}>
        <h2 className="text-xl font-semibold" id="nesafric-record">NesAfric record</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-surface p-4" data-testid="stat-rating"><dt className="text-sm text-muted">Average rating</dt><dd className="mt-1 text-xl font-semibold">{rating ? <><span aria-hidden="true" className="text-gold">★ </span>{rating.score}<span className="ml-1 text-sm font-normal text-muted">({rating.count.toLocaleString("en")} {rating.count === 1 ? "rating" : "ratings"})</span></> : <span className="text-base font-normal text-muted">No ratings yet</span>}</dd></div>
          <div className="rounded-2xl bg-surface p-4" data-testid="stat-jobs"><dt className="text-sm text-muted">Completed jobs</dt><dd className="mt-1 text-xl font-semibold">{provider.completedJobs.toLocaleString("en")}</dd></div>
          <div className="rounded-2xl bg-surface p-4" data-testid="stat-completion"><dt className="text-sm text-muted">Completion rate</dt><dd className="mt-1 text-xl font-semibold">{completion !== null ? `${completion}%` : <span className="text-base font-normal text-muted">Not enough completed history</span>}</dd></div>
        </dl>
        {completion !== null && provider.completionRateBasis ? <p className="mt-3 text-sm text-muted">Completion rate covers the {provider.completionRateBasis.toLocaleString("en")} jobs this provider accepted that have since finished.</p> : null}
      </section>

      <section aria-labelledby="provider-about" className={card}>
        <h2 className="text-xl font-semibold" id="provider-about">About</h2>
        <p className="mt-3 whitespace-pre-wrap text-ink">{provider.description || "This provider has not added a public description."}</p>
        {provider.categories.length ? <><h3 className="mt-5 text-sm font-semibold text-muted">Services</h3><ul className="mt-2 flex flex-wrap gap-2">{provider.categories.map((category) => <li className="rounded-full bg-surface px-3 py-1.5 text-sm" key={category.id}>{category.name}</li>)}</ul></> : null}
      </section>

      {provider.serviceAreas.length ? <section aria-labelledby="provider-areas" className={card}>
        <h2 className="text-xl font-semibold" id="provider-areas">Areas served</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">{provider.serviceAreas.map((area, index) => <li className="rounded-xl border border-hairline p-4" key={`${area.countryCode}-${index}`}><p className="font-medium">{formatServiceArea(area)}</p><p className="mt-1 text-sm text-muted">{[area.countryCode, area.region, area.city, area.district].filter(Boolean).join(" · ")}</p></li>)}</ul>
      </section> : null}

      {rate || response ? <section aria-labelledby="provider-stated" className={card}>
        <h2 className="text-xl font-semibold" id="provider-stated">From the provider</h2>
        <dl className="mt-3 grid gap-2">
          {rate ? <div className="flex justify-between gap-3 border-b border-hairline py-2"><dt className="text-muted">Starting rate</dt><dd className="font-semibold">{rate}</dd></div> : null}
          {response ? <div className="flex justify-between gap-3 border-b border-hairline py-2"><dt className="text-muted">Stated response time</dt><dd className="font-semibold">{response}</dd></div> : null}
        </dl>
        <p className="mt-3 text-sm text-muted">Set by the provider, not verified by NesAfric. Ask for a quote for your exact job.</p>
      </section> : null}
    </div>
    <aside className="min-w-0 scroll-mt-6" id="request-service"><RequestServicePanel provider={provider} properties={properties} maintenance={maintenance} submitting={submitting} error={error} success={success} onSubmit={enquire} /></aside>
  </div>;
}

/**
 * Request Service — the existing marketplace enquiry. It is sent by a property management
 * workspace (server-checked `marketplace.enquiry.create`); signed-out visitors are sent through the
 * existing sign-in flow and back here, and a success message appears only after the server accepts.
 */
function RequestServicePanel({ provider, properties, maintenance, submitting, error, success, onSubmit }: {
  provider: PublicProvider;
  properties: Property[];
  maintenance: Maintenance[];
  submitting: boolean;
  error: string;
  success: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { status } = useSavedProviders();
  const box = "sticky top-6 grid gap-4 rounded-3xl border border-hairline bg-white p-5 shadow-sm";
  if (status === "signedOut") {
    return <div className={box}><h2 className="text-xl font-semibold">Request service</h2><p className="text-sm text-muted">Requests are sent from your NesAfric property management account, so the provider knows which property the job is for and can reply to you.</p><a className={`${buttonClass("primary")} text-center`} href={signInHrefForCurrentPage()}><span className="whitespace-normal break-words">Sign in to request {provider.displayName}</span></a></div>;
  }
  return <form className={box} onSubmit={onSubmit}><div><h2 className="text-xl font-semibold">Request service</h2><p className="mt-1 text-sm text-muted">Enquiries remain private between your organisation and the provider.</p></div><label className="text-sm font-medium">Service category<select className="mt-1 w-full rounded-xl border border-hairline bg-warm-white p-3" name="categoryId" required>{provider.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="text-sm font-medium">Property <span className="font-normal text-muted">(optional)</span><select className="mt-1 w-full rounded-xl border border-hairline bg-warm-white p-3" name="propertyId"><option value="">No property link</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label className="text-sm font-medium">Maintenance request <span className="font-normal text-muted">(optional)</span><select className="mt-1 w-full rounded-xl border border-hairline bg-warm-white p-3" name="maintenanceRequestId"><option value="">No maintenance link</option>{maintenance.filter((request) => !["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(request.status)).map((request) => <option key={request.id} value={request.id}>{request.title} · {request.property.name}</option>)}</select></label><label className="text-sm font-medium">Message<textarea className="mt-1 w-full rounded-xl border border-hairline bg-warm-white p-3" minLength={1} name="message" required rows={5} /></label><label className="flex items-start gap-2 text-sm"><input className="mt-1" name="requestQuote" type="checkbox" />Request a formal quotation now (requires a maintenance request)</label><button className="rounded-lg bg-forest p-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={submitting}>{submitting ? "Sending…" : "Send request"}</button>{success && <p className="rounded-lg bg-teal/10 p-3 text-sm text-forest" role="status">{success}</p>}{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}<Link className="text-center text-sm font-semibold text-teal" href="/marketplace/requests">View request history</Link></form>;
}
