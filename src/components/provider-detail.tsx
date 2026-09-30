"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MarketplaceLogoUploader } from "@/components/marketplace-logo-uploader";
import { ProviderMarketplaceSettings } from "@/components/provider-marketplace-settings";

type Provider = { id: string; type: string; displayName: string; legalName: string | null; contactEmail: string | null; contactPhone: string | null; biography: string | null; verificationStatus: string; availabilityStatus: string; acceptingWork: boolean; identityVerifiedAt: string | null; businessVerifiedAt: string | null; skillVerifiedAt: string | null; categories: {
  category: {
    id: string;
    name: string;
    parent: {
      id: string;
      key: string;
      name: string;
      sortOrder: number;
    } | null;
  };
}[]; serviceAreas: { id: string; areaType: string; name: string }[]; evidence: { id: string; type: string; reviewStatus: string; rejectionReason: string | null; expiresAt: string | null }[]; verificationHistory: { id: string; fromStatus: string; toStatus: string; reason: string | null; createdAt: string }[] };
type Metrics = { assignments: number; accepted: number; declined: number; completed: number; acceptanceRate: number | null; onTimeRate: number | null; ratings: number; averageRating: number | null; averageQuality: number | null; averageTimeliness: number | null; averageCommunication: number | null; reputation?: { completedJobs: number; concludedJobs: number; completionRate: number | null } };
type Job = { id: string; status: string; assignedAt: string; acceptedAt: string | null; completedAt: string | null; declineReason: string | null; workOrder: { id: string; title: string; status: string; maintenanceRequest: { id: string; title: string; category: string; priority: string }; property: { name: string }; providerRating: { score: number; qualityScore: number | null; timelinessScore: number | null; communicationScore: number | null; comment: string | null } | null }; quotation: { totalAmountMinor: string; currencyCode: string } | null };

export type ProviderDetailSection =
  | "dashboard"
  | "profile"
  | "verification"
  | "jobs"
  | "availability";

export function ProviderDetail({
  providerId,
  section = "dashboard",
}: {
  providerId: string;
  section?: ProviderDetailSection;
}) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    // Organisation is optional here — a self-registered, directory-less provider has none at
    // all, and the underlying API grants full access to the profile's own owner regardless.
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    const headers: Record<string, string> = organisationId ? { "x-organisation-id": organisationId } : {};
    const [detailResponse, jobsResponse] = await Promise.all([fetch(`/api/providers/${providerId}`, { headers }), fetch(`/api/providers/${providerId}/jobs`, { headers })]);
    if (!detailResponse.ok) throw new Error((await detailResponse.json()).error?.message ?? "Unable to load provider.");
    const detail = await detailResponse.json(); setProvider(detail.provider); setMetrics(detail.metrics);
    setLogoUrl(detail.logo?.url ?? null); setViewerIsOwner(detail.viewerIsOwner === true);
    if (jobsResponse.ok) setJobs(await jobsResponse.json());
  }, [providerId]);
  useEffect(() => { const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load provider.")), 0); return () => clearTimeout(timer); }, [load]);
  async function mutate(url: string, method: string, body: unknown, message: string, scoped = true) {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    const response = await fetch(url, { method, headers: { "content-type": "application/json", ...(scoped && organisationId ? { "x-organisation-id": organisationId } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to update provider.");
    setError(""); setSuccess(message); await load();
  }
  if (error && !provider) return <p className="rounded-xl bg-red-50 p-6 text-red-800">{error}</p>;
  if (!provider || !metrics) return <p className="rounded-xl border border-hairline border-hairline bg-white p-6 text-muted">Loading provider profile...</p>;
  const hasOrganisationContext = typeof window !== "undefined" && Boolean(localStorage.getItem("propertyos.activeOrganisationId"));
  const showDashboard = section === "dashboard";
  const showProfile = section === "profile";
  const showVerification = section === "verification";
  const showJobs = section === "jobs";
  const showAvailability = section === "availability";

  if (!showDashboard) {
    return (
      <div className="grid gap-6">
        {(error || success) && (
          <p className={`rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-teal/10 text-teal"}`}>
            {error || success}
          </p>
        )}

        {showProfile && (
          <>
            {viewerIsOwner && (
              <section
                aria-labelledby="provider-logo-heading"
                className="rounded-2xl border border-hairline bg-white p-6 shadow-sm"
              >
                <h2 className="text-xl font-semibold" id="provider-logo-heading">
                  Logo
                </h2>
                <p className="mb-4 mt-1 text-sm text-muted">
                  Your logo appears on your NesAfric marketplace profile and provider cards.
                  Without one, your initials are shown.
                </p>
                <MarketplaceLogoUploader
                  canEdit
                  emptyHint="A logo helps property owners and managers recognise your business."
                  emptyTitle="Add your logo"
                  endpoint={`/api/providers/${provider.id}/logo`}
                  logoUrl={logoUrl}
                  name={provider.displayName}
                  onChange={(url) => {
                    setLogoUrl(url);
                    void load().catch(() => undefined);
                  }}
                  usage="This logo appears on your NesAfric marketplace profile and provider cards."
                />
              </section>
            )}

            <section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm">
              <div className="flex flex-col justify-between gap-4 md:flex-row">
                <div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-surface px-2 py-1">{provider.type}</span>
                    <span className="rounded-full bg-teal/10 px-2 py-1 text-teal">
                      {provider.verificationStatus}
                    </span>
                    <span className="rounded-full bg-gold/10 px-2 py-1 text-ink">
                      {provider.availabilityStatus}
                    </span>
                  </div>
                  <h2 className="mt-3 text-3xl font-semibold">{provider.displayName}</h2>
                  {provider.legalName && <p className="text-muted">{provider.legalName}</p>}
                </div>
                <Link
                  className="self-start rounded-xl border border-hairline px-4 py-2 text-sm font-semibold"
                  href="/marketplace/services"
                >
                  View Property Services
                </Link>
              </div>

              {provider.biography && (
                <p className="mt-5 whitespace-pre-wrap text-ink">{provider.biography}</p>
              )}

              <dl className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Email" value={provider.contactEmail ?? "Not provided"} />
                <Info label="Phone" value={provider.contactPhone ?? "Not provided"} />
                <Info
                  label="Categories"
                  value={
                    provider.categories.map(({ category }) => category.name).join(", ") || "None"
                  }
                />
                <Info
                  label="Service areas"
                  value={
                    provider.serviceAreas
                      .map((area) => `${area.areaType}: ${area.name}`)
                      .join(", ") || "None"
                  }
                />
              </dl>
            </section>

            <ProviderMarketplaceSettings
              providerId={provider.id}
              categories={provider.categories.map(({ category }) => category)}
            />
          </>
        )}

        {showVerification && (
          <>
            {provider.verificationStatus !== "VERIFIED" && (
              <div className="rounded-2xl border border-amber-200 bg-gold/10 p-5">
                <p className="font-semibold text-amber-900">Verification pending</p>
                <p className="mt-1 text-sm text-ink">
                  {provider.verificationStatus === "REQUIRES_MORE_INFORMATION"
                    ? "NesAfric needs more information before your identity can be verified — see the notes below."
                    : provider.verificationStatus === "REJECTED"
                      ? "Your identity verification was rejected — see the notes below."
                      : provider.verificationStatus === "SUSPENDED"
                        ? "Your provider profile has been suspended."
                        : "Complete your verification requirements and submit them for NesAfric review."}
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <VerificationLevelBadge label="Identity" verifiedAt={provider.identityVerifiedAt} />
              <VerificationLevelBadge label="Business" verifiedAt={provider.businessVerifiedAt} />
              <VerificationLevelBadge
                label="Skill / credential"
                verifiedAt={provider.skillVerifiedAt}
              />
            </div>

            <VerificationPanel
              hasOrganisationContext={hasOrganisationContext}
              mutate={mutate}
              provider={provider}
            />
          </>
        )}

        {showJobs && (
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Jobs</h2>
            <p className="mt-1 text-sm text-muted">
              Review assignments, accepted work, completed jobs and customer ratings.
            </p>

            {jobs.length ? (
              <div className="mt-4 grid gap-4">
                {jobs.map((job) => (
                  <article className="rounded-xl border border-hairline p-4" key={job.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <Link
                          className="font-semibold text-teal"
                          href={`/maintenance/${job.workOrder.maintenanceRequest.id}`}
                        >
                          {job.workOrder.title}
                        </Link>
                        <p className="text-sm text-muted">
                          {job.workOrder.property.name} ·{" "}
                          {job.workOrder.maintenanceRequest.category}
                        </p>
                      </div>
                      <span className="rounded-full bg-surface px-2 py-1 text-xs font-semibold">
                        {job.status}
                      </span>
                    </div>

                    {job.quotation && (
                      <p className="mt-2 text-sm">
                        Approved quote:{" "}
                        {money(job.quotation.totalAmountMinor, job.quotation.currencyCode)}
                      </p>
                    )}

                    {job.workOrder.providerRating ? (
                      <blockquote className="mt-3 rounded-lg bg-surface p-3 text-sm">
                        <strong>{job.workOrder.providerRating.score}/5</strong>
                        {job.workOrder.providerRating.comment &&
                          ` · ${job.workOrder.providerRating.comment}`}
                      </blockquote>
                    ) : job.status === "COMPLETED" ? (
                      <RatingForm
                        onSubmit={(body) =>
                          mutate(
                            `/api/maintenance/work-orders/${job.workOrder.id}/rating`,
                            "POST",
                            body,
                            "Provider review created.",
                          )
                        }
                      />
                    ) : null}

                    {job.status === "PENDING" && (
                      <div className="mt-3 flex gap-2">
                        <button
                          className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white"
                          onClick={() =>
                            mutate(
                              `/api/provider-assignments/${job.id}/response`,
                              "PATCH",
                              { response: "ACCEPTED" },
                              "Assignment accepted.",
                            )
                          }
                        >
                          Accept job
                        </button>
                        <button
                          className="rounded-xl border border-hairline px-3 py-2 text-sm font-semibold"
                          onClick={() =>
                            mutate(
                              `/api/provider-assignments/${job.id}/response`,
                              "PATCH",
                              {
                                response: "DECLINED",
                                declineReason: "Provider unavailable",
                              },
                              "Assignment declined.",
                            )
                          }
                        >
                          Decline job
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-hairline border-dashed p-8 text-center text-muted">
                No provider jobs yet.
              </p>
            )}
          </section>
        )}

        {showAvailability && (
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Availability</h2>
            <p className="mt-1 text-sm text-muted">
              Control whether your service provider workspace is accepting new work.
            </p>

            <form
              className="mt-5 grid max-w-xl gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void mutate(
                  `/api/providers/${provider.id}`,
                  "PATCH",
                  {
                    availabilityStatus: data.get("availabilityStatus"),
                    acceptingWork: data.get("acceptingWork") === "on",
                  },
                  "Availability updated.",
                  false,
                );
              }}
            >
              <label className="grid gap-1.5 text-sm font-medium">
                Availability status
                <select
                  className="rounded-xl border border-hairline p-2.5"
                  defaultValue={provider.availabilityStatus}
                  name="availabilityStatus"
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="LIMITED">Limited</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  defaultChecked={provider.acceptingWork}
                  name="acceptingWork"
                  type="checkbox"
                />
                Accepting new work
              </label>

              <button className="w-fit rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white">
                Save availability
              </button>
            </form>
          </section>
        )}
      </div>
    );
  }

  return <div className="grid gap-6">
    {(error || success) && <p className={`rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-teal/10 text-teal"}`}>{error || success}</p>}
    {provider.verificationStatus !== "VERIFIED" && (
      <div className="rounded-2xl border border-amber-200 bg-gold/10 p-5">
        <p className="font-semibold text-amber-900">Verification pending</p>
        <p className="mt-1 text-sm text-ink">
          {provider.verificationStatus === "REQUIRES_MORE_INFORMATION"
            ? "NesAfric needs more information before your identity can be verified — see the notes below."
            : provider.verificationStatus === "REJECTED"
              ? "Your identity verification was rejected — see the notes below."
              : provider.verificationStatus === "SUSPENDED"
                ? "Your provider profile has been suspended."
                : "Your dashboard is fully accessible, but you will not appear publicly on the NesAfric marketplace or receive NesAfric work assignments until NesAfric has reviewed and approved your identity verification."}
        </p>
      </div>
    )}
    <div className="grid gap-3 sm:grid-cols-3">
      <VerificationLevelBadge label="Identity" verifiedAt={provider.identityVerifiedAt} />
      <VerificationLevelBadge label="Business" verifiedAt={provider.businessVerifiedAt} />
      <VerificationLevelBadge label="Skill / credential" verifiedAt={provider.skillVerifiedAt} />
    </div>
    {viewerIsOwner && (
      <section aria-labelledby="provider-logo-heading" className="rounded-2xl border border-hairline bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold" id="provider-logo-heading">Logo</h2>
        <p className="mt-1 mb-4 text-sm text-muted">Your logo appears on your NesAfric marketplace profile and provider cards. Without one, your initials are shown.</p>
        <MarketplaceLogoUploader
          canEdit
          emptyHint="A logo helps property owners and managers recognise your business."
          emptyTitle="Add your logo"
          endpoint={`/api/providers/${provider.id}/logo`}
          logoUrl={logoUrl}
          name={provider.displayName}
          // Show the server's answer at once, then reload so the page matches what the API now returns.
          onChange={(url) => { setLogoUrl(url); void load().catch(() => undefined); }}
          usage="This logo appears on your NesAfric marketplace profile and provider cards."
        />
      </section>
    )}
    <section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm"><div className="flex flex-col justify-between gap-4 md:flex-row"><div><div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-surface px-2 py-1">{provider.type}</span><span className="rounded-full bg-teal/10 px-2 py-1 text-teal">{provider.verificationStatus}</span><span className="rounded-full bg-gold/10 px-2 py-1 text-ink">{provider.availabilityStatus}</span></div><h2 className="mt-3 text-3xl font-semibold">{provider.displayName}</h2>{provider.legalName && <p className="text-muted">{provider.legalName}</p>}</div><Link className="self-start rounded-xl border border-hairline px-4 py-2 text-sm font-semibold" href="/providers">Provider directory</Link></div>{provider.biography && <p className="mt-5 whitespace-pre-wrap text-ink">{provider.biography}</p>}<dl className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4"><Info label="Email" value={provider.contactEmail ?? "Not provided"} /><Info label="Phone" value={provider.contactPhone ?? "Not provided"} /><Info label="Categories" value={provider.categories.map(({ category }) => category.name).join(", ") || "None"} /><Info label="Service areas" value={provider.serviceAreas.map((area) => `${area.areaType}: ${area.name}`).join(", ") || "None"} /></dl></section>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Jobs assigned", metrics.assignments], ["Jobs completed", metrics.completed], ["Completion rate", completionLabel(metrics.reputation)], ["Average rating", metrics.averageRating ? `${metrics.averageRating.toFixed(1)} / 5` : "—"]].map(([label, value]) => <div className="rounded-2xl border border-hairline bg-white p-5 shadow-sm" key={label}><p className="text-sm text-muted">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</section>
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Provider job and rating history</h2>{jobs.length ? <div className="mt-4 grid gap-4">{jobs.map((job) => <article className="rounded-xl border border-hairline p-4" key={job.id}><div className="flex flex-wrap justify-between gap-2"><div><Link className="font-semibold text-teal" href={`/maintenance/${job.workOrder.maintenanceRequest.id}`}>{job.workOrder.title}</Link><p className="text-sm text-muted">{job.workOrder.property.name} · {job.workOrder.maintenanceRequest.category}</p></div><span className="rounded-full bg-surface px-2 py-1 text-xs font-semibold">{job.status}</span></div>{job.quotation && <p className="mt-2 text-sm">Approved quote: {money(job.quotation.totalAmountMinor, job.quotation.currencyCode)}</p>}{job.workOrder.providerRating ? <blockquote className="mt-3 rounded-lg bg-surface p-3 text-sm"><strong>{job.workOrder.providerRating.score}/5</strong>{job.workOrder.providerRating.comment && ` · ${job.workOrder.providerRating.comment}`}</blockquote> : job.status === "COMPLETED" ? <RatingForm onSubmit={(body) => mutate(`/api/maintenance/work-orders/${job.workOrder.id}/rating`, "POST", body, "Provider review created.")} /> : null}{job.status === "PENDING" && <div className="mt-3 flex gap-2"><button className="rounded-lg bg-forest px-3 py-2 text-sm font-semibold text-white" onClick={() => mutate(`/api/provider-assignments/${job.id}/response`, "PATCH", { response: "ACCEPTED" }, "Assignment accepted.")}>Accept job</button><button className="rounded-xl border border-hairline px-3 py-2 text-sm font-semibold" onClick={() => mutate(`/api/provider-assignments/${job.id}/response`, "PATCH", { response: "DECLINED", declineReason: "Provider unavailable" }, "Assignment declined.")}>Decline job</button></div>}</article>)}</div> : <p className="mt-4 rounded-xl border border-hairline border-dashed p-8 text-center text-muted">No provider jobs yet.</p>}</section>
      <aside className="grid content-start gap-6"><section className="rounded-2xl border border-hairline bg-white p-5 shadow-sm"><h2 className="font-semibold">Availability</h2><form className="mt-3 grid gap-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(`/api/providers/${provider.id}`, "PATCH", { availabilityStatus: data.get("availabilityStatus"), acceptingWork: data.get("acceptingWork") === "on" }, "Availability updated.", false); }}><select className="rounded-xl border border-hairline p-2" defaultValue={provider.availabilityStatus} name="availabilityStatus"><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="UNAVAILABLE">Unavailable</option></select><label className="flex items-center gap-2 text-sm"><input defaultChecked={provider.acceptingWork} name="acceptingWork" type="checkbox" />Accepting new work</label><button className="rounded-xl border border-hairline p-2 text-sm font-semibold">Save availability</button></form></section><VerificationPanel hasOrganisationContext={hasOrganisationContext} mutate={mutate} provider={provider} /></aside>
    </div>
    <ProviderMarketplaceSettings providerId={provider.id} categories={provider.categories.map(({ category }) => category)} />
  </div>;
}

/** Displays the server's completion rate (never computed here); below the minimum history the
 * server sends null, which is shown neutrally rather than as 0% or 100%. */
function completionLabel(reputation: Metrics["reputation"]) {
  if (!reputation || reputation.completionRate === null) return "Not enough completed history";
  return `${Math.round(reputation.completionRate * 100)}%`;
}

function VerificationLevelBadge({ label, verifiedAt }: { label: string; verifiedAt: string | null }) {
  return <div className={`rounded-xl border border-hairline p-3 text-sm ${verifiedAt ? "border-emerald-200 bg-teal/10" : "border-hairline bg-surface"}`}>
    <p className="font-semibold">{label}</p>
    <p className={verifiedAt ? "text-teal" : "text-muted"}>{verifiedAt ? "Verified" : "Not yet verified"}</p>
  </div>;
}

function VerificationPanel({ provider, mutate, hasOrganisationContext }: { provider: Provider; mutate: (url: string, method: string, body: unknown, message: string, scoped?: boolean) => Promise<void>; hasOrganisationContext: boolean }) {
  return <section className="rounded-2xl border border-hairline bg-white p-5 shadow-sm">
    <h2 className="font-semibold">Verification</h2>
    <p className="mt-1 text-sm text-muted">{provider.evidence.length} document{provider.evidence.length === 1 ? "" : "s"} submitted · {provider.verificationHistory.length} status change{provider.verificationHistory.length === 1 ? "" : "s"}</p>
    {provider.evidence.length > 0 && <div className="mt-3 grid gap-1.5">
      {provider.evidence.map((item) => <div className="flex items-center justify-between rounded-xl border border-hairline p-2 text-xs" key={item.id}>
        <span>{item.type.replaceAll("_", " ")}</span>
        <span className={item.reviewStatus === "APPROVED" ? "text-teal" : item.reviewStatus === "REJECTED" ? "text-red-700" : "text-muted"}>{item.reviewStatus}{item.rejectionReason ? ` — ${item.rejectionReason}` : ""}</span>
      </div>)}
    </div>}
    {["UNVERIFIED", "REJECTED", "REQUIRES_MORE_INFORMATION"].includes(provider.verificationStatus) && <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(`/api/providers/${provider.id}/verification`, "POST", { evidence: [{ type: data.get("type"), reference: data.get("reference") }] }, "Verification submitted.", false); }}><select className="rounded-xl border border-hairline p-2 text-sm" name="type"><option value="GHANA_CARD_FRONT">Ghana Card (front)</option><option value="GHANA_CARD_BACK">Ghana Card (back)</option><option value="BUSINESS_REGISTRATION">Business registration</option><option value="PROFESSIONAL_LICENSE">Professional licence</option><option value="OTHER">Other</option></select><input className="rounded-xl border border-hairline p-2 text-sm" name="reference" placeholder="Evidence reference" required /><button className="rounded-xl border border-hairline p-2 text-sm font-semibold">Submit additional evidence</button></form>}
    {hasOrganisationContext && provider.verificationStatus === "PENDING" && <div className="mt-3 grid grid-cols-2 gap-2"><button className="rounded-lg bg-forest p-2 text-sm font-semibold text-white" onClick={() => mutate(`/api/providers/${provider.id}/verification/review`, "PATCH", { status: "VERIFIED" }, "Provider verified.")}>Verify (landlord directory)</button><button className="rounded-xl border border-hairline p-2 text-sm font-semibold text-red-700" onClick={() => mutate(`/api/providers/${provider.id}/verification/review`, "PATCH", { status: "REJECTED", reason: "Evidence requires correction" }, "Verification rejected.")}>Reject</button></div>}
  </section>;
}
function RatingForm({ onSubmit }: { onSubmit: (body: unknown) => void }) { return <form className="mt-3 flex flex-wrap gap-2 rounded-xl border border-hairline p-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit({ score: Number(data.get("score")), comment: data.get("comment") || undefined }); }}><select className="rounded-xl border border-hairline p-2 text-sm" name="score">{[5,4,3,2,1].map((score) => <option key={score}>{score}</option>)}</select><input className="min-w-0 flex-1 rounded-xl border border-hairline p-2 text-sm" name="comment" placeholder="Review" /><button className="rounded-xl border border-hairline px-3 text-sm font-semibold">Add review</button></form>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1">{value}</dd></div>; }
function money(value: string, currency: string) { return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value) / 100); }
