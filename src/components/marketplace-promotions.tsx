"use client";

import { type FormEvent, useEffect, useState } from "react";

type Campaign = { id: string; name: string; placement: string; status: string; headline: string; impressionCount: number; clickCount: number; rejectionReason: string | null };

const PLACEMENTS = [
  { value: "SEARCH_FEATURED", label: "Feature my listing in search" },
  { value: "PROFESSIONAL_FEATURED", label: "Feature my company/profile" },
  { value: "DEVELOPMENT_FEATURED", label: "Promote my development" },
  { value: "MARKETPLACE_INLINE", label: "Run a marketplace banner" },
];

const STATUS_COPY: Record<string, string> = {
  DRAFT: "Draft — not yet submitted",
  PENDING_APPROVAL: "Submitted — awaiting Umo Afric review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  ACTIVE: "Live",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  REJECTED: "Not approved",
  ARCHIVED: "Archived",
};

/** Self-service promotion request readiness (item 22) — request/submission only, no live
 * advertising payment flow. Every request starts as a DRAFT and requires explicit platform
 * approval (item 21) before it can ever appear publicly. */
export function MarketplacePromotions({ professionalId }: { professionalId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/campaigns`);
    const body = await response.json();
    if (response.ok) setCampaigns(body);
    else setError(body.error?.message ?? "Unable to load promotion requests.");
  }

  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}/campaigns`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setCampaigns(body);
      else setError(body.error?.message ?? "Unable to load promotion requests.");
    });
  }, [professionalId]);

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/campaigns`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"), placement: form.get("placement"), headline: form.get("headline"),
        supportingText: form.get("supportingText") || undefined, destinationUrl: form.get("destinationUrl"),
      }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to create that request.");
    setNotice("Promotion request created as a draft."); (event.target as HTMLFormElement).reset(); await load();
  }

  async function submit(campaignId: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/campaigns/${campaignId}/submit`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to submit that request.");
    setNotice("Submitted for Umo Afric review."); await load();
  }

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Request a promotion</h2>
        <p className="mt-1 text-sm text-slate-600">Requests are reviewed by Umo Afric before appearing publicly. This is request/submission readiness — not yet a live self-service ad purchase.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={createRequest}>
          <input className="rounded border p-2 text-sm sm:col-span-2" name="name" placeholder="Internal name for this request" required />
          <select className="rounded border p-2 text-sm sm:col-span-2" name="placement" required>
            {PLACEMENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input className="rounded border p-2 text-sm sm:col-span-2" name="headline" placeholder="Headline" required />
          <input className="rounded border p-2 text-sm sm:col-span-2" name="supportingText" placeholder="Supporting text (optional)" />
          <input className="rounded border p-2 text-sm sm:col-span-2" name="destinationUrl" placeholder="https://… (link to your listing, development, or profile)" required type="url" />
          <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white sm:col-span-2" type="submit">Create draft request</button>
        </form>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Your promotion requests</h2>
        {!campaigns ? <p className="mt-3 text-sm text-slate-500">Loading…</p> : campaigns.length === 0 ? <p className="mt-3 text-sm text-slate-500">No promotion requests yet.</p> : (
          <ul className="mt-3 divide-y">
            {campaigns.map((campaign) => (
              <li className="grid gap-1.5 py-3" key={campaign.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{campaign.name}</p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold">{STATUS_COPY[campaign.status] ?? campaign.status}</span>
                </div>
                <p className="text-sm text-slate-600">{campaign.headline}</p>
                {campaign.status === "ACTIVE" && <p className="text-xs text-slate-500">{campaign.impressionCount} impressions · {campaign.clickCount} clicks</p>}
                {campaign.rejectionReason && <p className="text-xs text-red-600">Not approved: {campaign.rejectionReason}</p>}
                {campaign.status === "DRAFT" && <button className="justify-self-start text-xs font-semibold text-emerald-700" onClick={() => void submit(campaign.id)} type="button">Submit for review</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
