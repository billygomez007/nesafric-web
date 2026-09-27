"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SubmitForReviewDialog } from "@/components/listing-submit-review-dialog";
import { buttonClass } from "@/components/ui/button-styles";
import { listingReadinessProblems } from "@/modules/listings/readiness";
import { priceUnitText } from "@/lib/listing-display";

type Listing = {
  id: string; title: string; status: string; verificationStatus: string; listingType: string;
  city: string | null; marketplaceAssetId: string | null; listingRepresentativeUserId: string | null;
  listingAuthority: string | null;
  category?: string | null; publicDescription?: string | null;
  rentAmountMinor?: string | null; askingAmountMinor?: string | null; currencyCode?: string | null; frequency?: string | null;
  locality?: string | null; district?: string | null; region?: string | null; publicLocationLabel?: string | null;
  bedrooms?: number | null; bathrooms?: string | number | null; sizeSqm?: string | number | null;
  media?: { id: string; type: string; publicUrl: string; isCover: boolean; altText: string | null }[];
  statusHistory?: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
  verificationEvidence?: { id: string }[];
};

/** Verification states that need (re)submitted authority evidence before review. */
const NEEDS_EVIDENCE = ["UNVERIFIED", "REJECTED", "SUSPENDED"];
const SUBMITTABLE = ["DRAFT", "REJECTED"];

/** The reviewer's note when NesAfric returned or declined this listing, if that is its latest step. */
function reviewerNote(item: Listing): { title: string; note: string } | null {
  const latest = item.statusHistory?.at(-1);
  if (!latest?.note) return null;
  if (item.status === "DRAFT" && latest.fromStatus === "PENDING_REVIEW" && latest.toStatus === "DRAFT") return { title: "NesAfric asked for changes", note: latest.note };
  if (item.status === "REJECTED" && latest.toStatus === "REJECTED") return { title: "Not approved by NesAfric", note: latest.note };
  return null;
}

const EDITABLE_STATUSES = ["DRAFT", "REJECTED", "PAUSED"];

function formatPrice(item: Listing) {
  const minor = item.rentAmountMinor ?? item.askingAmountMinor;
  if (!minor) return "Price on request";
  const value = Number(minor) / 100;
  const currency = item.currencyCode ?? "GHS";
  let text: string;
  try {
    text = new Intl.NumberFormat(currency === "GHS" ? "en-GH" : "en", { style: "currency", currency, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
  } catch {
    text = `${currency} ${value.toLocaleString("en")}`;
  }
  const suffix = priceUnitText(item.listingType, item.frequency);
  return suffix ? `${text} / ${suffix}` : text;
}

function locationLine(item: Listing) {
  return item.publicLocationLabel || [item.locality, item.district, item.city].filter(Boolean).slice(0, 2).join(", ") || item.region || "Location not set";
}

function coverPhoto(item: Listing) {
  const photos = (item.media ?? []).filter((media) => media.type === "PHOTO");
  return photos.find((media) => media.isCover) ?? photos[0] ?? null;
}

function humanize(value: string | null | undefined) {
  if (!value) return "";
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function specs(item: Listing) {
  const parts: string[] = [];
  if (item.bedrooms != null) parts.push(item.bedrooms === 0 ? "Studio" : `${item.bedrooms} bed`);
  if (item.bathrooms != null && item.bathrooms !== "") parts.push(`${Number(item.bathrooms)} bath`);
  if (item.sizeSqm != null && item.sizeSqm !== "") parts.push(`${Number(item.sizeSqm).toLocaleString("en")} m²`);
  return parts;
}

function Thumbnail({ item, className }: { item: Listing; className: string }) {
  const cover = coverPhoto(item);
  if (!cover) {
    return (
      <div className={`flex items-center justify-center bg-surface text-muted ${className}`}>
        <span className="flex flex-col items-center gap-1 text-xs">
          <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="4" /><path d="m7 15 3-3 3 3 2-2 3 3" /><circle cx="8.5" cy="8.5" r="1.5" /></svg>
          No photo yet
        </span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL
  return <img alt={cover.altText ?? item.title} className={`bg-surface object-cover ${className}`} decoding="async" loading="lazy" src={cover.publicUrl} />;
}

/** How the listing will look on the marketplace, from the data the owner already has. Used for
 * anything not yet published (the public page only serves published listings). */
function ListingPreview({ item, onClose }: { item: Listing; onClose: () => void }) {
  const photos = (item.media ?? []).filter((media) => media.type === "PHOTO");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div aria-labelledby="listing-preview-title" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={onClose} role="dialog">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-3">
          <p className="text-sm font-semibold text-ink">Marketplace preview <span className="font-normal text-muted">· {humanize(item.status)}, not public yet</span></p>
          <button className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium" onClick={onClose} type="button">Close</button>
        </div>
        <Thumbnail className="aspect-[16/10] w-full" item={item} />
        {photos.length > 1 && (
          <div className="grid grid-cols-4 gap-1.5 px-5 pt-3">
            {photos.slice(1, 5).map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL
              <img alt={photo.altText ?? item.title} className="aspect-[4/3] w-full rounded-md bg-surface object-cover" key={photo.id} loading="lazy" src={photo.publicUrl} />
            ))}
          </div>
        )}
        <div className="px-5 pb-6 pt-4">
          <p className="text-sm font-semibold text-forest">{item.listingType === "RENT" ? "For rent" : "For sale"}{item.category ? ` · ${humanize(item.category)}` : ""}</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink" id="listing-preview-title">{item.title}</h2>
          <p className="mt-1 text-sm text-muted">{locationLine(item)}</p>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">{formatPrice(item)}</p>
          {specs(item).length > 0 && <p className="mt-1 text-sm text-muted">{specs(item).join(" · ")}</p>}
          {item.publicDescription && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink">{item.publicDescription}</p>}
        </div>
      </div>
    </div>
  );
}
type Page = { items: Listing[]; total: number; page: number; pageSize: number };

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: "bg-teal/10 text-teal",
  DRAFT: "bg-surface text-muted",
  PENDING_REVIEW: "bg-gold/10 text-ink",
  PAUSED: "bg-surface text-muted",
  ARCHIVED: "bg-surface text-muted",
  REJECTED: "bg-red-50 text-red-800",
};

export function MarketplaceListingsDashboard({ professionalId }: { professionalId: string }) {
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState<Listing | null>(null);
  const [submitting, setSubmitting] = useState("");
  const [evidenceFor, setEvidenceFor] = useState<Listing | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [cardMessage, setCardMessage] = useState<{ id: string; text: string } | null>(null);

  const load = async () => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (statusFilter) query.set("status", statusFilter);
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings?${query.toString()}`);
    const body = await response.json();
    if (response.ok) setData(body); else setError(body.error?.message ?? "Unable to load listings.");
  };

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (statusFilter) query.set("status", statusFilter);
    fetch(`/api/marketplace-professionals/${professionalId}/listings?${query.toString()}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setData(body); else setError(body.error?.message ?? "Unable to load listings.");
    });
  }, [professionalId, page, statusFilter]);

  async function transition(listingId: string, status: string) {
    setError("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings/${listingId}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const body = await response.json();
    if (!response.ok) setError(body.error?.message ?? "Unable to update listing."); else await load();
  }

  /** One action for the professional: checks the listing, collects authority evidence only when
   * NesAfric doesn't already have it, and sends the listing (and its verification) for review. */
  function startSubmit(item: Listing) {
    setError("");
    setCardMessage(null);
    const problems = listingReadinessProblems({ ...item, publicDescription: item.publicDescription ?? "" });
    if (problems.length) {
      setCardMessage({ id: item.id, text: `Before submitting: ${problems.map(({ message }) => message).join(" ")}` });
      return;
    }
    if (NEEDS_EVIDENCE.includes(item.verificationStatus)) {
      setDialogError("");
      setEvidenceFor(item);
      return;
    }
    void submitForReview(item, null);
  }

  async function submitForReview(item: Listing, evidence: { type: string; reference: string } | null) {
    setSubmitting(item.id);
    setDialogError("");
    try {
      const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings/${item.id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evidence ? { evidence } : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body.error?.message ?? "Unable to submit this listing for review.";
        if (evidenceFor) setDialogError(message); else setCardMessage({ id: item.id, text: message });
        return;
      }
      setEvidenceFor(null);
      setCardMessage({ id: item.id, text: "Submitted. NesAfric will review the listing and its authority evidence before it goes live." });
      await load();
    } finally {
      setSubmitting("");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Listings</h1>
          <p className="mt-1 text-sm text-muted">Standalone and development inventory marketed through this professional profile.</p>
        </div>
        <Link className="rounded-lg bg-forest px-4 py-2.5 text-sm font-semibold text-white" href={`/pro/${professionalId}/listings/new`}>
          New standalone listing
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {["", "DRAFT", "PENDING_REVIEW", "REJECTED", "PUBLISHED", "PAUSED", "ARCHIVED"].map((status) => (
          <button
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === status ? "border-slate-950 bg-forest text-white" : "border-hairline text-muted hover:border-hairline"}`}
            key={status || "all"}
            onClick={() => { setStatusFilter(status); setPage(1); }}
            type="button"
          >
            {status ? status.replaceAll("_", " ") : "All"}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl border border-hairline border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {!data ? <p className="text-muted">Loading…</p> : data.items.length === 0 ? (
        <p className="rounded-xl border border-hairline border-dashed p-10 text-center text-muted">No marketplace listings match this filter.</p>
      ) : (
        <div className="grid gap-3">
          {data.items.map((item) => (
            <article className="overflow-hidden rounded-xl border border-hairline bg-white" key={item.id}>
              <div className="flex flex-col md:flex-row">
                <Thumbnail className="aspect-[16/9] w-full md:aspect-auto md:h-auto md:min-h-[150px] md:w-56 md:shrink-0" item={item} />
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between md:gap-6 md:p-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                      <span className="text-forest">{item.listingType === "RENT" ? "For rent" : item.listingType === "SALE" ? "For sale" : humanize(item.listingType)}</span>
                      <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLES[item.status] ?? "bg-surface text-muted"}`}>{humanize(item.status)}</span>
                      {item.verificationStatus === "VERIFIED" && <span className="text-gold-ink">Verified</span>}
                    </p>
                    <h2 className="mt-1.5 truncate text-lg font-semibold text-ink" title={item.title}>{item.title}</h2>
                    <p className="mt-0.5 truncate text-sm text-muted">{locationLine(item)}</p>
                    <p className="mt-2 text-base font-semibold tabular-nums text-ink">{formatPrice(item)}</p>
                    <p className="mt-1 text-xs text-muted">
                      {[...specs(item), item.marketplaceAssetId ? "Marketplace listing" : "From a managed property", `verification ${item.verificationStatus.toLowerCase()}`, ...(item.listingRepresentativeUserId ? ["has a representative"] : [])].join(" · ")}
                    </p>
                    {item.status === "PENDING_REVIEW" && (
                      <p className="mt-2 text-sm text-muted">With NesAfric for review. It goes live once the listing and its authority evidence are verified.</p>
                    )}
                    {(() => {
                      const returned = reviewerNote(item);
                      return returned ? (
                        <div className="mt-3 rounded-[var(--radius-control)] border border-gold/40 bg-gold/10 p-3 text-sm">
                          <p className="font-semibold text-ink">{returned.title}</p>
                          <p className="mt-1 whitespace-pre-wrap text-ink">{returned.note}</p>
                        </div>
                      ) : null;
                    })()}
                    {cardMessage?.id === item.id && <p aria-live="polite" className="mt-2 text-sm text-ink" role="status">{cardMessage.text}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:max-w-[340px] md:justify-end">
                    {item.marketplaceAssetId && (EDITABLE_STATUSES.includes(item.status) ? (
                      <Link className="rounded-md bg-forest px-3 py-2 text-sm font-semibold text-white hover:bg-emerald" href={`/pro/${professionalId}/listings/${item.id}/edit`}>Edit property</Link>
                    ) : (
                      <span className="rounded-md border border-dashed px-3 py-2 text-sm text-muted" title={item.status === "PUBLISHED" ? "Pause this listing to edit it." : "Listings in review, reserved, let or archived can't be edited."}>
                        {item.status === "PUBLISHED" ? "Pause to edit" : "Editing locked"}
                      </span>
                    ))}
                    {item.status === "PUBLISHED" ? (
                      <a className="rounded-md border px-3 py-2 text-sm font-medium hover:border-forest/40" href={`/marketplace/properties/${item.id}`} rel="noopener noreferrer" target="_blank">
                        Preview <span className="sr-only">(opens the live listing in a new tab)</span><span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <button className="rounded-md border px-3 py-2 text-sm font-medium hover:border-forest/40" onClick={() => setPreviewing(item)} type="button">Preview</button>
                    )}
                    {SUBMITTABLE.includes(item.status) && (
                      <button className={buttonClass("primary", "sm")} disabled={submitting === item.id} onClick={() => startSubmit(item)} type="button">
                        {submitting === item.id ? "Submitting…" : "Submit for review"}
                      </button>
                    )}
                    {item.status === "PUBLISHED" && <button className="rounded-md border px-3 py-2 text-sm font-medium" onClick={() => void transition(item.id, "PAUSED")} type="button">Pause</button>}
                    {item.status === "PAUSED" && <button className="rounded-md border px-3 py-2 text-sm font-medium" onClick={() => void transition(item.id, "PUBLISHED")} type="button">Publish</button>}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewing && <ListingPreview item={previewing} onClose={() => setPreviewing(null)} />}
      {evidenceFor && (
        <SubmitForReviewDialog
          busy={submitting === evidenceFor.id}
          error={dialogError}
          hasExistingEvidence={(evidenceFor.verificationEvidence?.length ?? 0) > 0}
          listingTitle={evidenceFor.title}
          onCancel={() => setEvidenceFor(null)}
          onSubmit={(evidence) => void submitForReview(evidenceFor, evidence)}
        />
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-muted">
          <p>Page {data.page} of {totalPages} · {data.total} listings</p>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:border-hairline disabled:text-muted" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button>
            <button className="rounded-md border px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:border-hairline disabled:text-muted" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
