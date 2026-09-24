"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type ListingRow = {
  id: string;
  listingType: string;
  category: string;
  title: string;
  askingAmountMinor: string | null;
  rentAmountMinor: string | null;
  currencyCode: string;
  frequency: string | null;
  availableFrom: string;
  countryCode: string;
  region: string | null;
  city: string | null;
  district: string | null;
  locality: string | null;
  publicLocationLabel: string | null;
  status: string;
  verificationStatus: string;
  evidenceReady: boolean;
  listingAuthority: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  organisation: {
    id: string;
    name: string;
    type: string;
    countryCode: string;
  };
  marketplaceProfessional: {
    id: string;
    displayName: string;
    slug: string;
    type: string;
    verificationStatus: string;
  } | null;
  createdBy: {
    id: string;
    displayName: string;
    email: string;
  };
  _count: {
    media: number;
    verificationEvidence: number;
    leads: number;
    viewingRequests: number;
  };
};

type ListingResponse = {
  summary: {
    total: number;
    pendingVerification: number;
    byStatus: Record<string, number>;
    byVerificationStatus: Record<string, number>;
  };
  listings: ListingRow[];
};

const STATUSES = [
  "",
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "PAUSED",
  "RESERVED",
  "RENTED",
  "ARCHIVED",
  "REJECTED",
];

const VERIFICATION_STATUSES = [
  "",
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
];

function amount(listing: ListingRow) {
  const raw =
    listing.listingType === "SALE"
      ? listing.askingAmountMinor
      : listing.rentAmountMinor;

  if (!raw) return "—";

  const value = Number(raw) / 100;

  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: listing.currencyCode,
    }).format(value);
  } catch {
    return `${listing.currencyCode} ${value.toFixed(2)}`;
  }
}

function ListingsContent() {
  const [data, setData] = useState<ListingResponse | null>(null);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [status, setStatus] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [activeVerificationStatus, setActiveVerificationStatus] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ take: "100" });

    if (activeSearch.trim()) {
      params.set("search", activeSearch.trim());
    }

    if (activeStatus) {
      params.set("status", activeStatus);
    }

    if (activeVerificationStatus) {
      params.set("verificationStatus", activeVerificationStatus);
    }

    fetch(`/api/platform-admin/listings?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load listings.",
          );
        }

        return body as ListingResponse;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(
          err instanceof Error ? err.message : "Unable to load listings.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [activeSearch, activeStatus, activeVerificationStatus]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setActiveSearch(search);
    setActiveStatus(status);
    setActiveVerificationStatus(verificationStatus);
  }

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Marketplace inventory
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Listings
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Platform-wide listing visibility across PropertyOS organisations and
          Marketplace Professional inventory.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total", data?.summary.total ?? 0],
          ["Published", data?.summary.byStatus.PUBLISHED ?? 0],
          ["Draft", data?.summary.byStatus.DRAFT ?? 0],
          ["Verified", data?.summary.byVerificationStatus.VERIFIED ?? 0],
          ["Pending verification", data?.summary.pendingVerification ?? 0],
        ].map(([label, value]) => (
          <div
            className="rounded-xl border border-hairline bg-white p-4 shadow-card"
            key={String(label)}
          >
            <p className="text-xs uppercase tracking-wider text-muted">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-forest">{value}</p>
          </div>
        ))}
      </section>

      <form
        className="grid gap-3 rounded-xl border border-hairline bg-white p-4 shadow-card xl:grid-cols-[1fr_190px_210px_auto_auto]"
        onSubmit={submit}
      >
        <input
          className="rounded-lg border border-hairline px-4 py-2.5 text-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Listing, organisation, city or professional"
          value={search}
        />

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          {STATUSES.map((entry) => (
            <option key={entry || "ALL"} value={entry}>
              {entry ? entry.replaceAll("_", " ") : "All listing statuses"}
            </option>
          ))}
        </select>

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
          onChange={(event) => setVerificationStatus(event.target.value)}
          value={verificationStatus}
        >
          {VERIFICATION_STATUSES.map((entry) => (
            <option key={entry || "ALL"} value={entry}>
              {entry
                ? entry.replaceAll("_", " ")
                : "All verification statuses"}
            </option>
          ))}
        </select>

        <button
          className="rounded-lg bg-forest px-5 py-2.5 text-sm font-semibold text-white"
          type="submit"
        >
          Apply
        </button>

        <button
          className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-semibold text-forest"
          onClick={() => {
            setLoading(true);
            setSearch("");
            setStatus("");
            setVerificationStatus("");
            setActiveSearch("");
            setActiveStatus("");
            setActiveVerificationStatus("");
          }}
          type="button"
        >
          Reset
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading listings…</p>
      ) : !data?.listings.length ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <p className="font-semibold text-forest">No listings found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4">Listing</th>
                  <th className="px-5 py-4">Owner / marketer</th>
                  <th className="px-5 py-4">Location</th>
                  <th className="px-5 py-4">Price</th>
                  <th className="px-5 py-4">Listing status</th>
                  <th className="px-5 py-4">Verification</th>
                  <th className="px-5 py-4">Evidence</th>
                  <th className="px-5 py-4">Engagement</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {data.listings.map((listing) => (
                  <tr
                    className="align-top hover:bg-warm-white/60"
                    key={listing.id}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {listing.title}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {listing.listingType} · {listing.category}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {listing.id.slice(0, 8)}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {listing.marketplaceProfessional?.displayName ??
                          listing.organisation.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {listing.marketplaceProfessional
                          ? listing.marketplaceProfessional.type.replaceAll(
                              "_",
                              " ",
                            )
                          : listing.organisation.type.replaceAll("_", " ")}
                      </p>
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {listing.publicLocationLabel ??
                        [listing.locality, listing.city, listing.region]
                          .filter(Boolean)
                          .join(", ") ??
                        listing.countryCode}
                    </td>

                    <td className="px-5 py-4 font-semibold text-forest">
                      {amount(listing)}
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {listing.status.replaceAll("_", " ")}
                    </td>

                    <td className="px-5 py-4">
                      <span className="rounded-full bg-warm-white px-2.5 py-1 text-xs font-semibold text-forest">
                        {listing.verificationStatus.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {listing._count.verificationEvidence} document
                      {listing._count.verificationEvidence === 1 ? "" : "s"}
                      <br />
                      {listing._count.media} media
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {listing._count.leads} leads
                      <br />
                      {listing._count.viewingRequests} viewings
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformAdminListingsPage() {
  return (
    <PlatformAdminShell>
      <ListingsContent />
    </PlatformAdminShell>
  );
}
