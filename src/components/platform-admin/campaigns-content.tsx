"use client";

import { type FormEvent, useEffect, useState } from "react";

type Campaign = {
  id: string; name: string; placement: string; status: string; priority: number; headline: string;
  destinationUrl: string; isPlatformOwned: boolean; impressionCount: number; clickCount: number;
  advertiser: { displayName: string; slug: string } | null; rejectionReason: string | null;
};

const PLACEMENTS = ["HOMEPAGE_ANNOUNCEMENT", "MARKETPLACE_PRIMARY", "MARKETPLACE_INLINE", "DEVELOPMENT_FEATURED", "PROFESSIONAL_FEATURED", "SEARCH_FEATURED"];

export function CampaignsAdminContent() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    const response = await fetch(`/api/platform-admin/campaigns?${params}`);
    const body = await response.json();
    if (response.ok) setCampaigns(body.items);
    else setError(body.error?.message ?? "Unable to load campaigns.");
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/platform-admin/campaigns?${params}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setCampaigns(body.items);
      else setError(body.error?.message ?? "Unable to load campaigns.");
    });
  }, [statusFilter]);

  async function createPlatformCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/platform-admin/campaigns", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"), placement: form.get("placement"), headline: form.get("headline"),
        supportingText: form.get("supportingText") || undefined, ctaLabel: form.get("ctaLabel") || undefined,
        destinationUrl: form.get("destinationUrl"), priority: Number(form.get("priority") || 0),
      }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to create that campaign.");
    setNotice("Campaign created."); (event.target as HTMLFormElement).reset(); await load();
  }

  async function review(campaignId: string, status: "APPROVED" | "REJECTED") {
    setError(""); setNotice("");
    const reason = status === "REJECTED" ? window.prompt("Reason for rejection?") ?? undefined : undefined;
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/review`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, reason }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to review that campaign.");
    setNotice(`Campaign ${status.toLowerCase()}.`); await load();
  }

  async function setStatus(campaignId: string, status: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/status`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update that campaign.");
    setNotice("Campaign updated."); await load();
  }

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Create a NesAfric-owned campaign</h2>
        <p className="mt-1 text-sm text-slate-600">Homepage announcements and platform-curated marketplace placements. Starts APPROVED (or SCHEDULED once a start date is set) — never a self-service submission.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={createPlatformCampaign}>
          <input className="rounded border p-2 text-sm" name="name" placeholder="Internal name" required />
          <select className="rounded border p-2 text-sm" name="placement" required>
            {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{placement.replaceAll("_", " ")}</option>)}
          </select>
          <input className="rounded border p-2 text-sm sm:col-span-2" name="headline" placeholder="Headline" required />
          <input className="rounded border p-2 text-sm sm:col-span-2" name="supportingText" placeholder="Supporting text (optional)" />
          <input className="rounded border p-2 text-sm" name="ctaLabel" placeholder="CTA label (optional)" />
          <input className="rounded border p-2 text-sm" name="destinationUrl" placeholder="https://…" required type="url" />
          <input className="rounded border p-2 text-sm" defaultValue={0} min={0} name="priority" placeholder="Priority" type="number" />
          <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white sm:col-span-2" type="submit">Create campaign</button>
        </form>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">All campaigns</h2>
          <select className="rounded border p-1.5 text-sm" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            <option value="">All statuses</option>
            {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "REJECTED", "ARCHIVED"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        {!campaigns ? <p className="mt-3 text-sm text-slate-500">Loading…</p> : campaigns.length === 0 ? <p className="mt-3 text-sm text-slate-500">No campaigns match this filter.</p> : (
          <ul className="mt-3 divide-y">
            {campaigns.map((campaign) => (
              <li className="grid gap-2 py-3" key={campaign.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{campaign.name}</p>
                    <p className="text-xs text-slate-500">{campaign.placement.replaceAll("_", " ")} · {campaign.isPlatformOwned ? "NesAfric" : campaign.advertiser?.displayName ?? "Unknown advertiser"}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold">{campaign.status.replaceAll("_", " ")}</span>
                </div>
                <p className="text-sm text-slate-600">{campaign.headline}</p>
                <p className="text-xs text-slate-400">{campaign.impressionCount} impressions · {campaign.clickCount} clicks · priority {campaign.priority}</p>
                {campaign.rejectionReason && <p className="text-xs text-red-600">Rejected: {campaign.rejectionReason}</p>}
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  {campaign.status === "PENDING_APPROVAL" && <>
                    <button className="text-emerald-700" onClick={() => void review(campaign.id, "APPROVED")} type="button">Approve</button>
                    <button className="text-red-600" onClick={() => void review(campaign.id, "REJECTED")} type="button">Reject</button>
                  </>}
                  {["SCHEDULED", "ACTIVE"].includes(campaign.status) && <button className="text-amber-700" onClick={() => void setStatus(campaign.id, "PAUSED")} type="button">Pause</button>}
                  {campaign.status === "PAUSED" && <button className="text-emerald-700" onClick={() => void setStatus(campaign.id, "ACTIVE")} type="button">Resume</button>}
                  {["ACTIVE", "PAUSED", "SCHEDULED"].includes(campaign.status) && <button className="text-slate-600" onClick={() => void setStatus(campaign.id, "COMPLETED")} type="button">Complete</button>}
                  {["COMPLETED", "REJECTED", "PAUSED", "DRAFT"].includes(campaign.status) && <button className="text-slate-400" onClick={() => void setStatus(campaign.id, "ARCHIVED")} type="button">Archive</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
