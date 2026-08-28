"use client";

import { useEffect, useState } from "react";

type EvidenceItem = {
  id: string; type: string; reviewStatus: string; rejectionReason: string | null;
  storageObjectId: string | null; createdAt: string; supersededByEvidenceId: string | null;
};
type Consent = { version: string; accurate: boolean; authorized: boolean; reviewConsented: boolean; termsAccepted: boolean; acceptedAt: string };
type HistoryEntry = { id: string; fromStatus: string; toStatus: string; reason: string | null; createdAt: string; metadata: { authority?: string } | null };
type ProviderSummary = {
  id: string; displayName: string; type: string; verificationStatus: string; updatedAt: string;
  evidence: EvidenceItem[]; verificationConsents: Consent[];
};
type ProviderDetail = ProviderSummary & {
  identityVerifiedAt: string | null; businessVerifiedAt: string | null; skillVerifiedAt: string | null;
  verificationHistory: HistoryEntry[];
  categories: { category: { name: string } }[];
  serviceAreas: { areaType: string; name: string }[];
};

export function ServiceProvidersAdminContent() {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadList() {
    const response = await fetch("/api/platform-admin/service-providers");
    const body = await response.json();
    if (response.ok) setProviders(body);
    else setError(body.error?.message ?? "Unable to load the review queue.");
  }

  async function loadDetail(providerId: string) {
    setSelectedId(providerId);
    const response = await fetch(`/api/platform-admin/service-providers/${providerId}`);
    const body = await response.json();
    if (response.ok) setDetail(body);
    else setError(body.error?.message ?? "Unable to load this provider.");
  }

  useEffect(() => {
    fetch("/api/platform-admin/service-providers").then(async (response) => {
      const body = await response.json();
      if (response.ok) setProviders(body);
      else setError(body.error?.message ?? "Unable to load the review queue.");
    });
  }, []);

  async function viewDocument(storageObjectId: string | null) {
    if (!storageObjectId) return setError("This document has no retrievable file (it may be from a legacy submission).");
    const response = await fetch(`/api/documents/${storageObjectId}/signed-url`);
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to generate a secure link for this document.");
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  async function reviewEvidence(evidenceId: string, status: "APPROVED" | "REJECTED") {
    if (!selectedId) return;
    setError(""); setNotice("");
    const reason = status === "REJECTED" ? window.prompt("Reason for rejecting this document?") ?? undefined : undefined;
    if (status === "REJECTED" && !reason) return;
    const response = await fetch(`/api/providers/${selectedId}/verification/evidence/${evidenceId}/review`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, reason }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to review this document.");
    setNotice(`Document ${status.toLowerCase()}.`);
    await loadDetail(selectedId);
  }

  async function reviewIdentity(status: "VERIFIED" | "REJECTED" | "REQUIRES_MORE_INFORMATION") {
    if (!selectedId) return;
    setError(""); setNotice("");
    const reason = status !== "VERIFIED" ? window.prompt(`Reason${status === "REJECTED" ? " for rejection" : " more information is needed"}?`) ?? undefined : undefined;
    if (status !== "VERIFIED" && !reason) return;
    const response = await fetch(`/api/providers/${selectedId}/verification/platform-review`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, reason }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to record this decision.");
    setNotice(`Provider identity verification: ${status.replaceAll("_", " ").toLowerCase()}.`);
    await Promise.all([loadDetail(selectedId), loadList()]);
  }

  if (providers === null) return <p className="text-sm text-slate-500">Loading review queue…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <div>
        <h2 className="text-lg font-semibold">Pending identity review ({providers.length})</h2>
        {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <div className="mt-4 grid gap-2">
          {providers.length === 0 && <p className="text-sm text-slate-500">Nothing awaiting review.</p>}
          {providers.map((provider) => (
            <button
              className={`rounded-lg border p-3 text-left text-sm ${selectedId === provider.id ? "border-emerald-600 bg-emerald-50" : ""}`}
              key={provider.id}
              onClick={() => loadDetail(provider.id)}
              type="button"
            >
              <p className="font-semibold">{provider.displayName}</p>
              <p className="mt-0.5 text-xs text-slate-500">{provider.type} · {provider.verificationStatus} · {provider.evidence.length} document{provider.evidence.length === 1 ? "" : "s"}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        {!detail ? <p className="text-sm text-slate-500">Select a provider to review.</p> : (
          <div className="grid gap-5">
            <div>
              <h2 className="text-xl font-semibold">{detail.displayName}</h2>
              <p className="mt-1 text-sm text-slate-500">{detail.type} · Status: {detail.verificationStatus}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-1 font-semibold ${detail.identityVerifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Identity {detail.identityVerifiedAt ? "verified" : "pending"}</span>
                <span className={`rounded-full px-2.5 py-1 font-semibold ${detail.businessVerifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Business {detail.businessVerifiedAt ? "verified" : "not verified"}</span>
                <span className={`rounded-full px-2.5 py-1 font-semibold ${detail.skillVerifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Skill/credential {detail.skillVerifiedAt ? "verified" : "not verified"}</span>
              </div>
            </div>

            <div>
              <h3 className="font-semibold">Submitted documents</h3>
              <div className="mt-2 grid gap-2">
                {detail.evidence.map((item) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" key={item.id}>
                    <div>
                      <p className="font-medium">{item.type.replaceAll("_", " ")}</p>
                      <p className="text-xs text-slate-500">{item.reviewStatus}{item.rejectionReason ? ` · ${item.rejectionReason}` : ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="rounded border px-2.5 py-1 text-xs font-semibold" onClick={() => viewDocument(item.storageObjectId)} type="button">View</button>
                      {item.reviewStatus === "PENDING" && <>
                        <button className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white" onClick={() => reviewEvidence(item.id, "APPROVED")} type="button">Approve</button>
                        <button className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white" onClick={() => reviewEvidence(item.id, "REJECTED")} type="button">Reject</button>
                      </>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold">Consent</h3>
              {detail.verificationConsents[0] ? (
                <p className="mt-1 text-sm text-slate-600">Version {detail.verificationConsents[0].version} accepted {new Date(detail.verificationConsents[0].acceptedAt).toLocaleString()} — all four statements confirmed.</p>
              ) : <p className="mt-1 text-sm text-amber-700">No consent recorded yet.</p>}
            </div>

            <div>
              <h3 className="font-semibold">Overall identity decision</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => reviewIdentity("VERIFIED")} type="button">Verify identity</button>
                <button className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => reviewIdentity("REQUIRES_MORE_INFORMATION")} type="button">Request more information</button>
                <button className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => reviewIdentity("REJECTED")} type="button">Reject</button>
              </div>
            </div>

            <div>
              <h3 className="font-semibold">History</h3>
              <div className="mt-2 grid gap-1 text-xs text-slate-500">
                {detail.verificationHistory.map((entry) => (
                  <p key={entry.id}>{new Date(entry.createdAt).toLocaleString()} — {entry.fromStatus} → {entry.toStatus}{entry.metadata?.authority ? ` (${entry.metadata.authority})` : ""}{entry.reason ? `: ${entry.reason}` : ""}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
