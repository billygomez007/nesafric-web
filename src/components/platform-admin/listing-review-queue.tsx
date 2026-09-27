"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass } from "@/components/ui/button-styles";
import { fieldLabelClass, textareaClass } from "@/components/ui/field-styles";
import { priceUnitText } from "@/lib/listing-display";

export type ReviewListing = {
  id: string;
  title: string;
  listingType: string;
  category: string;
  status: string;
  verificationStatus: string;
  submittedAt: string | null;
  updatedAt: string;
  askingAmountMinor: string | null;
  rentAmountMinor: string | null;
  currencyCode: string;
  frequency: string | null;
  city: string | null;
  district: string | null;
  locality: string | null;
  region: string | null;
  publicLocationLabel: string | null;
  countryCode: string;
  listingAuthority: string | null;
  organisation: { id: string; name: string };
  marketplaceProfessional: { id: string; displayName: string; slug: string; verificationStatus: string } | null;
  cover: { publicUrl: string; altText: string | null } | null;
  photoCount: number;
  readinessProblems: Array<{ field: string; message: string }>;
  evidence: Array<{ id: string; type: string; privateReference?: string; createdAt: string; expiresAt: string | null }>;
  _count: { verificationEvidence: number; media: number };
};

type Decision = { kind: "publish" | "changes" | "reject"; listing: ReviewListing };

const EVIDENCE_LABELS: Record<string, string> = {
  owner_mandate: "Owner mandate",
  listing_authority: "Listing authority document",
  developer_authority: "Developer authority",
  ownership_reference: "Ownership reference",
};

function humanize(value: string) {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function price(listing: ReviewListing) {
  const minor = listing.listingType === "RENT" ? listing.rentAmountMinor : listing.askingAmountMinor;
  if (!minor) return "No price";
  const value = Number(minor) / 100;
  let text: string;
  try {
    text = new Intl.NumberFormat(listing.currencyCode === "GHS" ? "en-GH" : "en", { style: "currency", currency: listing.currencyCode, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
  } catch {
    text = `${listing.currencyCode} ${value.toLocaleString("en")}`;
  }
  const suffix = priceUnitText(listing.listingType, listing.frequency);
  return suffix ? `${text} / ${suffix}` : text;
}

function location(listing: ReviewListing) {
  return listing.publicLocationLabel || [listing.locality, listing.district, listing.city, listing.region].filter(Boolean).slice(0, 3).join(", ") || listing.countryCode;
}

/** What a reviewer can do with this listing right now, and why not when nothing. */
export function reviewState(listing: ReviewListing) {
  const inReview = listing.status === "PENDING_REVIEW";
  const verificationReady = listing.verificationStatus === "PENDING" || listing.verificationStatus === "VERIFIED";
  const ready = inReview && verificationReady && listing.readinessProblems.length === 0 && listing.photoCount > 0;
  let blocker: string | null = null;
  if (!inReview) blocker = listing.status === "DRAFT" ? "Returned to the professional — waiting for them to resubmit." : `Listing is ${humanize(listing.status).toLowerCase()}, not in review.`;
  else if (!verificationReady) blocker = "Verification not submitted — ask the professional for authority evidence.";
  else if (listing.readinessProblems.length) blocker = listing.readinessProblems.map(({ message }) => message).join(" ");
  return { inReview, ready, blocker, publishLabel: listing.verificationStatus === "VERIFIED" ? "Publish" : "Verify & publish" };
}

export function ListingReviewQueue({ listings, canDecide, highlightId, onDecided }: {
  listings: ReviewListing[];
  canDecide: boolean;
  highlightId?: string | null;
  onDecided: (listingId: string) => void;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    if (highlightId) document.getElementById(`review-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId, listings.length]);

  function open(kind: Decision["kind"], listing: ReviewListing) {
    setDecision({ kind, listing });
    setNote("");
    setError("");
    setDone("");
  }

  async function decide(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!decision) return;
    const path = decision.kind === "publish" ? "publish" : decision.kind === "changes" ? "request-changes" : "reject";
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/platform-admin/listings/${decision.listing.id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: decision.listing.updatedAt, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error?.message ?? "That decision could not be saved."); return; }
      setDone(
        decision.kind === "publish" ? `"${decision.listing.title}" is verified and live on the marketplace.`
          : decision.kind === "changes" ? `"${decision.listing.title}" was returned to the professional for changes.`
            : `"${decision.listing.title}" was rejected.`,
      );
      onDecided(decision.listing.id);
      setDecision(null);
    } finally {
      setBusy(false);
    }
  }

  const needsNote = decision?.kind !== "publish";
  const noteValid = !needsNote || note.trim().length >= 3;

  return (
    <>
      {done && <p className="mx-5 mt-4 rounded-[var(--radius-control)] border border-success/30 bg-success-tint p-3 text-sm text-ink" role="status">{done}</p>}
      {!listings.length ? (
        <p className="p-6 text-sm text-muted">No listings are waiting for review.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {listings.map((listing) => {
            const state = reviewState(listing);
            return (
              <li className={`grid gap-4 p-4 sm:p-5 md:grid-cols-[176px_minmax(0,1fr)] xl:grid-cols-[176px_minmax(0,1fr)_auto] ${highlightId === listing.id ? "bg-gold/5 ring-2 ring-inset ring-gold/50" : ""}`} id={`review-${listing.id}`} key={listing.id}>
                {listing.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL
                  <img alt={listing.cover.altText ?? listing.title} className="aspect-[4/3] w-full rounded-[var(--radius-control)] bg-surface object-cover" loading="lazy" src={listing.cover.publicUrl} />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-control)] bg-surface text-xs text-muted">No photo</div>
                )}
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-surface px-2 py-0.5 text-ink">{humanize(listing.status)}</span>
                    <span className={`rounded-full px-2 py-0.5 ${listing.verificationStatus === "VERIFIED" ? "bg-gold/15 text-gold-ink" : listing.verificationStatus === "PENDING" ? "bg-gold/10 text-ink" : "bg-danger-tint text-danger-ink"}`}>
                      Verification {humanize(listing.verificationStatus).toLowerCase()}
                    </span>
                  </p>
                  <h4 className="mt-2 break-words text-base font-semibold text-ink">{listing.title}</h4>
                  <p className="mt-0.5 text-sm text-muted">
                    {listing.marketplaceProfessional?.displayName ?? listing.organisation.name} · {location(listing)}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold tabular-nums text-ink">
                    {price(listing)} <span className="font-normal text-muted">· {listing.listingType === "RENT" ? "For rent" : "For sale"} · {humanize(listing.category)}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {listing.photoCount} photo{listing.photoCount === 1 ? "" : "s"} · {listing._count.verificationEvidence} evidence reference{listing._count.verificationEvidence === 1 ? "" : "s"}
                    {listing.listingAuthority ? ` · listed as ${humanize(listing.listingAuthority).toLowerCase()}` : ""}
                  </p>
                  {listing.evidence.length > 0 && (
                    <ul className="mt-2 grid gap-1 text-xs">
                      {listing.evidence.map((item) => (
                        <li className="rounded-[var(--radius-control)] bg-surface px-2.5 py-1.5 text-ink" key={item.id}>
                          <span className="font-semibold">{EVIDENCE_LABELS[item.type] ?? humanize(item.type)}</span>
                          {item.privateReference ? <span className="break-words"> — {item.privateReference}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {state.blocker && <p className="mt-2 text-sm text-danger-ink">{state.blocker}</p>}
                </div>
                <div className="flex flex-wrap items-start gap-2 md:col-span-2 xl:col-span-1 xl:w-44 xl:flex-col xl:items-stretch">
                  {!canDecide ? (
                    <p className="text-xs text-muted">View only — your role can&apos;t decide listings.</p>
                  ) : state.inReview ? (
                    <>
                      <button className={buttonClass("primary", "sm")} disabled={!state.ready} onClick={() => open("publish", listing)} type="button">{state.publishLabel}</button>
                      <button className={buttonClass("secondary", "sm")} onClick={() => open("changes", listing)} type="button">Request changes</button>
                      <button className={buttonClass("secondary", "sm").replace("text-forest", "text-danger-ink")} onClick={() => open("reject", listing)} type="button">Reject</button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {decision && (
        <Dialog
          busy={busy}
          description={
            decision.kind === "publish" ? (
              <>
                This {decision.listing.verificationStatus === "VERIFIED" ? "" : "marks the listing's authority evidence as verified and "}makes
                <span className="font-medium text-ink"> {decision.listing.title}</span> public on the NesAfric marketplace straight away. Buyers and tenants can see and enquire about it.
              </>
            ) : decision.kind === "changes" ? (
              <>The listing goes back to the professional as a draft. They&apos;ll see your note, can edit it and resubmit. Their evidence is kept.</>
            ) : (
              <>The listing and its pending verification are marked rejected. The professional sees your note and can still edit and resubmit.</>
            )
          }
          footer={
            <>
              <button className={buttonClass("secondary")} disabled={busy} onClick={() => setDecision(null)} type="button">Cancel</button>
              <button className={buttonClass(decision.kind === "reject" ? "danger" : "primary")} disabled={busy || !noteValid} form="listing-decision-form" type="submit">
                {busy ? "Saving…" : decision.kind === "publish" ? `${reviewState(decision.listing).publishLabel} now` : decision.kind === "changes" ? "Return for changes" : "Reject listing"}
              </button>
            </>
          }
          onClose={() => setDecision(null)}
          title={decision.kind === "publish" ? `${reviewState(decision.listing).publishLabel}?` : decision.kind === "changes" ? "Request changes" : "Reject listing"}
        >
          <form id="listing-decision-form" onSubmit={(event) => void decide(event)}>
            <label className={fieldLabelClass} htmlFor="decision-note">
              {needsNote ? "What needs to change (shown to the professional)" : "Note (optional, kept in the audit trail)"}
            </label>
            <textarea className={textareaClass} id="decision-note" maxLength={2000} onChange={(event) => setNote(event.target.value)} required={needsNote} rows={3} value={note} />
            {error && <p className="mt-3 rounded-[var(--radius-control)] border border-red-200 bg-danger-tint p-3 text-sm text-danger-ink" role="alert">{error}</p>}
          </form>
        </Dialog>
      )}
    </>
  );
}
