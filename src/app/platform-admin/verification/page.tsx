"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Queue = {
  listings: Array<{
    id: string;
    title: string;
    listingType: string;
    category: string;
    verificationStatus: string;
    evidenceReady: boolean;
    submittedAt: string | null;
    createdAt: string;
    updatedAt: string;
    city: string | null;
    countryCode: string;
    organisation: {
      id: string;
      name: string;
    };
    marketplaceProfessional: {
      id: string;
      displayName: string;
      slug: string;
      verificationStatus: string;
    } | null;
    _count: {
      verificationEvidence: number;
      media: number;
    };
  }>;
  professionals: Array<{
    id: string;
    displayName: string;
    legalName: string | null;
    type: string;
    countryCode: string;
    verificationStatus: string;
    verificationEvidenceReferences: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  providerCount: number;
};

function VerificationContent() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    const controller = new AbortController();

    fetch("/api/platform-admin/verification", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load verification queue.",
          );
        }

        return body as Queue;
      })
      .then((body) => {
        setQueue(body);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load verification queue.",
        );
      });

    return controller;
  }, []);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  async function reviewListing(
    listingId: string,
    status: "VERIFIED" | "REJECTED" | "SUSPENDED",
  ) {
    const note = window.prompt(
      `Reason or note for ${status.replaceAll("_", " ").toLowerCase()}:`,
    );

    if (note === null) return;

    setBusy(`listing:${listingId}`);
    setError("");

    try {
      const response = await fetch(
        `/api/platform-admin/listings/${listingId}/verification`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status,
            note: note.trim() || undefined,
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Listing verification review failed.",
        );
      }

      setQueue((current) =>
        current
          ? {
              ...current,
              listings: current.listings.filter(
                (listing) => listing.id !== listingId,
              ),
            }
          : current,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Listing verification review failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function reviewProfessional(
    professionalId: string,
    status: "VERIFIED" | "REJECTED" | "SUSPENDED",
  ) {
    const reason = window.prompt(
      `Reason or note for ${status.replaceAll("_", " ").toLowerCase()}:`,
    );

    if (reason === null) return;

    setBusy(`professional:${professionalId}`);
    setError("");

    try {
      const response = await fetch(
        `/api/platform-admin/professionals/${professionalId}/verification`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status,
            reason: reason.trim() || undefined,
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error?.message ??
            "Professional verification review failed.",
        );
      }

      setQueue((current) =>
        current
          ? {
              ...current,
              professionals: current.professionals.filter(
                (professional) => professional.id !== professionalId,
              ),
            }
          : current,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Professional verification review failed.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-7">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Trust & safety
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Verification Queue
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Review pending listing and Real Estate Professional trust decisions.
          Provider identity evidence remains in the dedicated provider review
          console.
        </p>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {!queue ? (
        <p className="text-sm text-muted">Loading verification queue…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Pending listings
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {queue.listings.length}
              </p>
            </div>
            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Pending professionals
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {queue.professionals.length}
              </p>
            </div>
            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Provider identity queue
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {queue.providerCount}
              </p>
              <Link
                className="mt-3 inline-flex text-xs font-semibold text-teal"
                href="/platform-admin/service-providers"
              >
                Review providers →
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-white shadow-card">
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-semibold text-forest">
                Listing verification
              </h3>
            </div>

            {!queue.listings.length ? (
              <p className="p-6 text-sm text-muted">
                No listings are awaiting verification.
              </p>
            ) : (
              <div className="divide-y divide-hairline">
                {queue.listings.map((listing) => (
                  <div
                    className="grid gap-4 p-5 xl:grid-cols-[1fr_auto]"
                    key={listing.id}
                  >
                    <div>
                      <p className="font-semibold text-forest">
                        {listing.title}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {listing.marketplaceProfessional?.displayName ??
                          listing.organisation.name}
                        {" · "}
                        {listing.city ?? listing.countryCode}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {listing._count.verificationEvidence} verification
                        document
                        {listing._count.verificationEvidence === 1 ? "" : "s"}
                        {" · "}
                        {listing._count.media} media item
                        {listing._count.media === 1 ? "" : "s"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        disabled={busy === `listing:${listing.id}`}
                        onClick={() =>
                          reviewListing(listing.id, "VERIFIED")
                        }
                        type="button"
                      >
                        Verify
                      </button>
                      <button
                        className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                        disabled={busy === `listing:${listing.id}`}
                        onClick={() =>
                          reviewListing(listing.id, "REJECTED")
                        }
                        type="button"
                      >
                        Reject
                      </button>
                      <button
                        className="rounded-lg border border-hairline px-3 py-2 text-xs font-semibold text-forest disabled:opacity-50"
                        disabled={busy === `listing:${listing.id}`}
                        onClick={() =>
                          reviewListing(listing.id, "SUSPENDED")
                        }
                        type="button"
                      >
                        Suspend
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-hairline bg-white shadow-card">
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-semibold text-forest">
                Real Estate Professional verification
              </h3>
            </div>

            {!queue.professionals.length ? (
              <p className="p-6 text-sm text-muted">
                No professional profiles are awaiting verification.
              </p>
            ) : (
              <div className="divide-y divide-hairline">
                {queue.professionals.map((professional) => (
                  <div
                    className="grid gap-4 p-5 xl:grid-cols-[1fr_auto]"
                    key={professional.id}
                  >
                    <div>
                      <p className="font-semibold text-forest">
                        {professional.displayName}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {professional.type.replaceAll("_", " ")}
                        {" · "}
                        {professional.countryCode}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {professional.verificationEvidenceReferences.length}{" "}
                        submitted evidence reference
                        {professional.verificationEvidenceReferences.length ===
                        1
                          ? ""
                          : "s"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        disabled={
                          busy === `professional:${professional.id}`
                        }
                        onClick={() =>
                          reviewProfessional(professional.id, "VERIFIED")
                        }
                        type="button"
                      >
                        Verify
                      </button>
                      <button
                        className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                        disabled={
                          busy === `professional:${professional.id}`
                        }
                        onClick={() =>
                          reviewProfessional(professional.id, "REJECTED")
                        }
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminVerificationPage() {
  return (
    <PlatformAdminShell>
      <VerificationContent />
    </PlatformAdminShell>
  );
}
