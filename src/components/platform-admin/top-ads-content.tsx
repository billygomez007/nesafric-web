"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass, fieldLabelClass } from "@/components/ui/field-styles";
import { ErrorState, LoadingState, SuccessNotice } from "@/components/ui/states";
import { formatListingPrice, humanize, priceUnitText } from "@/lib/listing-display";

type ListingSummary = {
  id: string;
  title: string;
  status: string;
  verificationStatus: string;
  listingType: string;
  category: string;
  location: string;
  price: { amountMinor: string | null; currencyCode: string; frequency: string | null };
  listedBy: string;
  coverUrl: string | null;
};

export type TopAdStatus = "active" | "scheduled" | "expired" | "paused" | "unavailable";

export type TopAdItem = {
  id: string;
  listingId: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  status: TopAdStatus;
  listing: ListingSummary;
};

type Payload = { items: TopAdItem[]; maxActive: number };
type Candidate = ListingSummary & { isTopAd: boolean };

const STATUS_COPY: Record<TopAdStatus, { label: string; tone: string; detail: string }> = {
  active: { label: "Live", tone: "border-emerald/30 bg-emerald/10 text-forest", detail: "Shown first on the property marketplace." },
  scheduled: { label: "Scheduled", tone: "border-hairline bg-warm-white text-ink", detail: "Starts showing at its start date." },
  expired: { label: "Ended", tone: "border-hairline bg-warm-white text-muted", detail: "Its end date has passed." },
  paused: { label: "Paused", tone: "border-hairline bg-warm-white text-muted", detail: "Switched off. Not shown." },
  unavailable: { label: "Not live", tone: "border-warning/30 bg-warning-tint text-warning-ink", detail: "The listing is no longer published and verified on the marketplace, so it is hidden." },
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function priceText(listing: ListingSummary) {
  if (!listing.price.amountMinor) return "Price on request";
  const unit = priceUnitText(listing.listingType, listing.price.frequency);
  return `${formatListingPrice(listing.price.amountMinor, listing.price.currencyCode)}${unit ? ` ${unit}` : ""}`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** `datetime-local` value (viewer's local time) for an ISO timestamp, and back. */
function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function scheduleText(item: Pick<TopAdItem, "startsAt" | "endsAt">) {
  const starts = formatDate(item.startsAt);
  const ends = formatDate(item.endsAt);
  if (!starts && !ends) return "No schedule — runs until removed";
  if (starts && ends) return `${starts} – ${ends}`;
  return starts ? `From ${starts}` : `Until ${ends}`;
}

function StatusBadge({ status }: { status: TopAdStatus }) {
  const copy = STATUS_COPY[status];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${copy.tone}`}>{copy.label}</span>;
}

function ListingThumb({ listing }: { listing: ListingSummary }) {
  return listing.coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- public listing media URL of unknown host
    <img alt="" className="h-14 w-20 shrink-0 rounded-lg border border-hairline object-cover" src={listing.coverUrl} />
  ) : (
    <div aria-hidden="true" className="h-14 w-20 shrink-0 rounded-lg border border-hairline bg-warm-white" />
  );
}

export function TopAdsContent() {
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TopAdItem | null>(null);
  const [scheduling, setScheduling] = useState<TopAdItem | null>(null);

  const fetchTopAds = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/platform-admin/top-ads", { cache: "no-store", signal });
    if (!response.ok) throw new Error(await readError(response, "Top Ads could not be loaded."));
    return (await response.json()) as Payload;
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await fetchTopAds());
      setLoadError("");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Top Ads could not be loaded.");
    }
  }, [fetchTopAds]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTopAds(controller.signal)
      .then(setData)
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : "Top Ads could not be loaded.");
      });
    return () => controller.abort();
  }, [fetchTopAds]);

  async function mutate(key: string, request: () => Promise<Response>, success: string, fallback: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const response = await request();
      if (!response.ok) throw new Error(await readError(response, fallback));
      setNotice(success);
      await reload();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return loadError
      ? <ErrorState message={loadError} onRetry={() => void reload()} title="Top Ads are unavailable" />
      : <LoadingState label="Loading Top Ads" />;
  }

  const items = data.items;
  const live = items.filter((item) => item.status === "active").length;
  const switchedOn = items.filter((item) => item.isActive).length;
  const attention = items.filter((item) => item.status === "unavailable").length;

  const patch = (item: TopAdItem, body: Record<string, unknown>, success: string, fallback: string) =>
    mutate(item.id, () => fetch(`/api/platform-admin/top-ads/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), success, fallback);

  function move(item: TopAdItem, direction: -1 | 1) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const ids = items.map((entry) => entry.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void mutate(
      item.id,
      () => fetch("/api/platform-admin/top-ads/order", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }),
      `“${item.listing.title}” moved to position ${target + 1}.`,
      "Could not reorder Top Ads.",
    );
  }

  return (
    <div className="grid gap-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Pin published property listings to the top of the public property marketplace on the website and in the apps.
          Top Ads use the normal property card and only appear when they match what the visitor is searching for. A listing
          that is unpublished, rejected or let is hidden automatically. Banner advertising stays in{" "}
          <Link className="font-semibold text-forest underline-offset-4 hover:underline" href="/platform-admin/campaigns">Campaigns</Link>.
        </p>
        <button className={buttonClass("primary")} onClick={() => { setAdding(true); setNotice(""); setError(""); }} type="button">
          Add Top Ad
        </button>
      </section>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-hairline lg:grid-cols-3">
        {[
          ["Live now", live, "Shown first on the marketplace"],
          ["Switched on", `${switchedOn} / ${data.maxActive}`, "Includes scheduled and ended"],
          ["Need attention", attention, "Listing no longer live"],
        ].map(([label, value, hint]) => (
          <div className="bg-white px-5 py-4" key={String(label)}>
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-forest-deep">{value}</dd>
            <dd className="mt-0.5 text-xs text-muted">{hint}</dd>
          </div>
        ))}
      </dl>

      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {error && <ErrorState message={error} title="That change was not saved" />}
      {loadError && <ErrorState message={loadError} onRetry={() => void reload()} title="Could not refresh" />}

      <section aria-labelledby="top-ads-heading" className="overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-forest-deep" id="top-ads-heading">Top Ads order</h2>
            <p className="mt-0.5 text-sm text-muted">Live Top Ads appear first on the property marketplace, in this order.</p>
          </div>
          <Link className={buttonClass("tertiary")} href="/marketplace/properties" target="_blank">View marketplace ↗</Link>
        </header>

        {items.length === 0 ? (
          <div className="px-5 py-10">
            <p className="font-semibold text-forest-deep">No Top Ads yet.</p>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted">The property marketplace shows listings in their normal order until you pin one.</p>
          </div>
        ) : (
          <ol className="divide-y divide-hairline">
            {items.map((item, index) => {
              const rowBusy = busy === item.id;
              return (
                <li className="grid gap-4 px-5 py-4 lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] lg:items-center" data-testid={`top-ad-${item.id}`} key={item.id}>
                  <span aria-label={`Position ${index + 1}`} className="hidden text-sm font-semibold tabular-nums text-muted lg:block">{index + 1}</span>
                  <div className="flex min-w-0 items-start gap-4">
                    <ListingThumb listing={item.listing} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">
                        <span className="text-muted lg:hidden">{index + 1}. </span>{item.listing.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{[item.listing.location, priceText(item.listing), item.listing.listedBy].filter(Boolean).join(" · ")}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={item.status} />
                        <span className="text-xs text-muted">{scheduleText(item)}</span>
                      </div>
                      {item.status !== "active" && <p className="mt-1.5 text-xs text-muted">{STATUS_COPY[item.status].detail}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button aria-label={`Move ${item.listing.title} up`} className={buttonClass("secondary", "sm")} disabled={busy !== null || index === 0} onClick={() => move(item, -1)} type="button">
                      <span aria-hidden="true">↑</span> Up
                    </button>
                    <button aria-label={`Move ${item.listing.title} down`} className={buttonClass("secondary", "sm")} disabled={busy !== null || index === items.length - 1} onClick={() => move(item, 1)} type="button">
                      <span aria-hidden="true">↓</span> Down
                    </button>
                    {item.isActive ? (
                      <button className={buttonClass("secondary", "sm")} disabled={rowBusy} onClick={() => void patch(item, { isActive: false }, `“${item.listing.title}” is paused.`, "Could not pause this Top Ad.")} type="button">Pause</button>
                    ) : (
                      <button className={buttonClass("primary", "sm")} disabled={rowBusy || item.status === "unavailable"} onClick={() => void patch(item, { isActive: true }, `“${item.listing.title}” is switched on.`, "Could not switch on this Top Ad.")} title={item.status === "unavailable" ? STATUS_COPY.unavailable.detail : undefined} type="button">Switch on</button>
                    )}
                    <button className={buttonClass("secondary", "sm")} disabled={rowBusy} onClick={() => setScheduling(item)} type="button">Schedule</button>
                    <button className={`${buttonClass("tertiary")} px-1 text-danger-ink hover:text-danger`} disabled={rowBusy} onClick={() => setRemoving(item)} type="button">Remove</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {adding && (
        <AddTopAdDialog
          onAdded={async (message) => { setAdding(false); setError(""); setNotice(message); await reload(); }}
          onClose={() => setAdding(false)}
        />
      )}

      {scheduling && (
        <ScheduleDialog
          item={scheduling}
          onClose={() => setScheduling(null)}
          onSave={async (startsAt, endsAt) => {
            const saved = await patch(scheduling, { startsAt, endsAt }, `Schedule saved for “${scheduling.listing.title}”.`, "Could not save the schedule.");
            if (saved) setScheduling(null);
          }}
          saving={busy === scheduling.id}
        />
      )}

      {removing && (
        <Dialog
          busy={busy === removing.id}
          description={`“${removing.listing.title}” will go back to its normal position on the marketplace. The listing itself is not changed.`}
          footer={
            <>
              <button className={buttonClass("secondary")} disabled={busy === removing.id} onClick={() => setRemoving(null)} type="button">Cancel</button>
              <button
                className={buttonClass("danger")}
                disabled={busy === removing.id}
                onClick={async () => {
                  const item = removing;
                  const done = await mutate(item.id, () => fetch(`/api/platform-admin/top-ads/${item.id}`, { method: "DELETE" }), `“${item.listing.title}” is no longer a Top Ad.`, "Could not remove this Top Ad.");
                  if (done) setRemoving(null);
                }}
                type="button"
              >
                Remove Top Ad
              </button>
            </>
          }
          onClose={() => setRemoving(null)}
          title="Remove this Top Ad?"
        />
      )}
    </div>
  );
}

function ScheduleDialog({ item, onClose, onSave, saving }: { item: TopAdItem; onClose: () => void; onSave: (startsAt: string | null, endsAt: string | null) => void; saving: boolean }) {
  const [startsAt, setStartsAt] = useState(toLocalInput(item.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(item.endsAt));
  const invalid = Boolean(startsAt && endsAt && new Date(endsAt) <= new Date(startsAt));
  return (
    <Dialog
      busy={saving}
      description="Leave a date empty to start now or run until removed. Times are in your local time zone."
      footer={
        <>
          <button className={buttonClass("secondary")} disabled={saving} onClick={onClose} type="button">Cancel</button>
          <button className={buttonClass("primary")} disabled={saving || invalid} onClick={() => onSave(fromLocalInput(startsAt), fromLocalInput(endsAt))} type="button">Save schedule</button>
        </>
      }
      onClose={onClose}
      title={`Schedule: ${item.listing.title}`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={fieldLabelClass}>Starts</span>
          <input className={controlClass} onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" value={startsAt} />
        </label>
        <label>
          <span className={fieldLabelClass}>Ends</span>
          <input className={controlClass} onChange={(event) => setEndsAt(event.target.value)} type="datetime-local" value={endsAt} />
        </label>
      </div>
      {invalid && <p className="mt-3 text-sm text-danger-ink" role="alert">The end must be after the start.</p>}
    </Dialog>
  );
}

function AddTopAdDialog({ onAdded, onClose }: { onAdded: (message: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/platform-admin/top-ads/candidates?search=${encodeURIComponent(search.trim())}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response, "Listings could not be searched."));
          return (await response.json()) as { items: Candidate[] };
        })
        .then((body) => { setCandidates(body.items); setSearchError(""); })
        .catch((caught) => {
          if (!controller.signal.aborted) setSearchError(caught instanceof Error ? caught.message : "Listings could not be searched.");
        });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  async function add(candidate: Candidate) {
    setAdding(candidate.id);
    setAddError("");
    try {
      const response = await fetch("/api/platform-admin/top-ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId: candidate.id }) });
      if (!response.ok) throw new Error(await readError(response, "Could not add this listing."));
      onAdded(`“${candidate.title}” is now a Top Ad.`);
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : "Could not add this listing.");
      setAdding(null);
    }
  }

  return (
    <Dialog
      busy={adding !== null}
      description="Only listings that are published, verified and live on the marketplace right now can be pinned."
      footer={<button className={buttonClass("secondary")} disabled={adding !== null} onClick={onClose} type="button">Done</button>}
      onClose={onClose}
      size="lg"
      title="Add a Top Ad"
    >
      <label className="block">
        <span className={fieldLabelClass}>Search published listings</span>
        <input className={controlClass} onChange={(event) => setSearch(event.target.value)} placeholder="Title, city or listing ID" type="search" value={search} />
      </label>
      {addError && <p className="mt-3 text-sm text-danger-ink" role="alert">{addError}</p>}
      {searchError ? (
        <p className="mt-4 text-sm text-danger-ink" role="alert">{searchError}</p>
      ) : candidates === null ? (
        <p aria-live="polite" className="mt-4 text-sm text-muted">Searching…</p>
      ) : candidates.length === 0 ? (
        <p aria-live="polite" className="mt-4 text-sm text-muted">No live listings match this search.</p>
      ) : (
        <ul aria-label="Published listings" className="mt-4 divide-y divide-hairline rounded-xl border border-hairline">
          {candidates.map((candidate) => (
            <li className="flex items-center gap-3 px-3 py-3" key={candidate.id}>
              <ListingThumb listing={candidate} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{candidate.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{[candidate.location, priceText(candidate), humanize(candidate.category)].filter(Boolean).join(" · ")}</p>
              </div>
              {candidate.isTopAd ? (
                <span className="text-xs font-medium text-muted">Already a Top Ad</span>
              ) : (
                <button aria-label={`Pin ${candidate.title} as a Top Ad`} className={buttonClass("primary", "sm")} disabled={adding !== null} onClick={() => void add(candidate)} type="button">
                  {adding === candidate.id ? "Adding…" : "Pin"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
