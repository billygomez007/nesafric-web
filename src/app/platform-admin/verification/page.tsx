"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";
import { ListingReviewQueue, type ReviewListing } from "@/components/platform-admin/listing-review-queue";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass } from "@/components/ui/button-styles";
import { fieldLabelClass, textareaClass } from "@/components/ui/field-styles";

type Queue = {
  listings: ReviewListing[];
  canDecideListings: boolean;
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
  // Deep link from Platform Admin > Listings: /platform-admin/verification?listing=<id>
  const highlightId = useSearchParams().get("listing");
  const [professionalDecision, setProfessionalDecision] = useState<{ id: string; name: string; status: "VERIFIED" | "REJECTED" } | null>(null);
  const [professionalReason, setProfessionalReason] = useState("");

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

  async function reviewProfessional(
    professionalId: string,
    status: "VERIFIED" | "REJECTED" | "SUSPENDED",
    reason: string,
  ) {
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
            reason: reason || undefined,
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
      setProfessionalDecision(null);
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
                Listings to review
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {queue.listings.filter((listing) => listing.status === "PENDING_REVIEW").length}
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
                Listing review
              </h3>
              <p className="mt-1 text-xs text-muted">
                Listings submitted for review with their authority evidence. Verify &amp; publish makes a listing public immediately.
              </p>
            </div>

            <ListingReviewQueue
              canDecide={queue.canDecideListings}
              highlightId={highlightId}
              listings={queue.listings}
              onDecided={() => { load(); }}
            />
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
                        className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                        disabled={
                          busy === `professional:${professional.id}`
                        }
                        onClick={() => {
                          setProfessionalReason("");
                          setProfessionalDecision({ id: professional.id, name: professional.displayName, status: "VERIFIED" });
                        }}
                        type="button"
                      >
                        Verify
                      </button>
                      <button
                        className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                        disabled={
                          busy === `professional:${professional.id}`
                        }
                        onClick={() => {
                          setProfessionalReason("");
                          setProfessionalDecision({ id: professional.id, name: professional.displayName, status: "REJECTED" });
                        }}
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

      {professionalDecision && (
        <Dialog
          busy={busy === `professional:${professionalDecision.id}`}
          description={professionalDecision.status === "VERIFIED"
            ? <>Marks <span className="font-medium text-ink">{professionalDecision.name}</span> as a verified professional on the public marketplace.</>
            : <>Rejects <span className="font-medium text-ink">{professionalDecision.name}</span>&apos;s verification request. They can resubmit evidence.</>}
          footer={
            <>
              <button className={buttonClass("secondary")} disabled={busy !== ""} onClick={() => setProfessionalDecision(null)} type="button">Cancel</button>
              <button
                className={buttonClass(professionalDecision.status === "REJECTED" ? "danger" : "primary")}
                disabled={busy !== "" || (professionalDecision.status === "REJECTED" && professionalReason.trim().length < 3)}
                onClick={() => void reviewProfessional(professionalDecision.id, professionalDecision.status, professionalReason.trim())}
                type="button"
              >
                {professionalDecision.status === "VERIFIED" ? "Verify professional" : "Reject verification"}
              </button>
            </>
          }
          onClose={() => setProfessionalDecision(null)}
          title={professionalDecision.status === "VERIFIED" ? "Verify professional" : "Reject verification"}
        >
          <label className={fieldLabelClass} htmlFor="professional-reason">
            {professionalDecision.status === "REJECTED" ? "Reason (required)" : "Note (optional)"}
          </label>
          <textarea className={textareaClass} id="professional-reason" maxLength={2000} onChange={(event) => setProfessionalReason(event.target.value)} rows={3} value={professionalReason} />
          {error && <p className="mt-3 text-sm text-danger-ink" role="alert">{error}</p>}
        </Dialog>
      )}
    </div>
  );
}

export default function PlatformAdminVerificationPage() {
  return (
    <PlatformAdminShell>
      <Suspense fallback={<p className="text-sm text-muted">Loading verification queue…</p>}>
        <VerificationContent />
      </Suspense>
    </PlatformAdminShell>
  );
}
