"use client";

import { type FormEvent, useEffect, useState } from "react";

type Campaign = {
  id: string; name: string; placement: string; type: string | null; status: string; priority: number;
  headline: string; supportingText: string | null; ctaLabel: string | null; destinationUrl: string;
  desktopMediaUrl: string | null; mobileMediaUrl: string | null;
  isPlatformOwned: boolean; impressionCount: number; clickCount: number;
  advertiser: { displayName: string; slug: string } | null;
  advertiserProvider: { displayName: string; slug: string; verificationStatus: string } | null;
  rejectionReason: string | null; startAt: string | null; endAt: string | null;
};
type ProviderOption = { id: string; displayName: string; type: string; verificationStatus: string };

const PLACEMENT_LABELS: Record<string, string> = {
  HOMEPAGE_ANNOUNCEMENT: "Homepage Announcement",
  MARKETPLACE_INLINE: "Marketplace Primary Carousel (Property Marketplace)",
  MARKETPLACE_PRIMARY: "Property Services Marketplace",
  PROFESSIONAL_FEATURED: "Professional Directory",
  DEVELOPMENT_FEATURED: "Development Feature",
  SEARCH_FEATURED: "Search Results Feature",
};
const PLACEMENTS = Object.keys(PLACEMENT_LABELS);

const TYPE_LABELS: Record<string, string> = {
  PROPERTY: "Property",
  DEVELOPMENT: "Development",
  REAL_ESTATE_PROFESSIONAL: "Real Estate Professional",
  REAL_ESTATE_COMPANY: "Real Estate Company",
  PROPERTY_SERVICE_PROFESSIONAL: "Property Service Professional",
  PROPERTY_SERVICE_COMPANY: "Property Service Company",
  UMOAFRIC_PROMOTION: "UmoAfric Promotion",
  ANNOUNCEMENT: "Announcement",
  GENERAL: "General / Sponsored",
};
const CAMPAIGN_TYPES = Object.keys(TYPE_LABELS);
const SERVICE_PROVIDER_TYPES = new Set(["PROPERTY_SERVICE_PROFESSIONAL", "PROPERTY_SERVICE_COMPANY"]);

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800",
  APPROVED: "bg-sky-50 text-sky-800",
  SCHEDULED: "bg-sky-50 text-sky-800",
  ACTIVE: "bg-emerald-50 text-emerald-800",
  PAUSED: "bg-amber-50 text-amber-800",
  COMPLETED: "bg-slate-100 text-slate-600",
  REJECTED: "bg-red-50 text-red-800",
  ARCHIVED: "bg-slate-100 text-slate-500",
};

const STATUS_TABS = [
  { label: "All", value: "" },
  { label: "Draft", value: "DRAFT" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Active", value: "ACTIVE" },
  { label: "Paused", value: "PAUSED" },
  { label: "Ended", value: "COMPLETED" },
];

function ctr(campaign: Campaign) {
  if (!campaign.impressionCount) return null;
  return (campaign.clickCount / campaign.impressionCount) * 100;
}

const emptyDraft = {
  name: "", type: "GENERAL", placement: "MARKETPLACE_INLINE", headline: "", supportingText: "",
  ctaLabel: "", destinationUrl: "", priority: "0", startAt: "", endAt: "", advertiserServiceProviderId: "",
};

export function CampaignsAdminContent() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [placementFilter, setPlacementFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  const [providerQuery, setProviderQuery] = useState("");
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (placementFilter) params.set("placement", placementFilter);
    const response = await fetch(`/api/platform-admin/campaigns?${params}`);
    const body = await response.json();
    if (response.ok) setCampaigns(body.items);
    else setError(body.error?.message ?? "Unable to load campaigns.");
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (placementFilter) params.set("placement", placementFilter);
    fetch(`/api/platform-admin/campaigns?${params}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setCampaigns(body.items);
      else setError(body.error?.message ?? "Unable to load campaigns.");
    });
  }, [statusFilter, placementFilter]);

  useEffect(() => {
    if (!SERVICE_PROVIDER_TYPES.has(draft.type)) return;
    const timer = setTimeout(() => {
      fetch(`/api/platform-admin/service-providers/search?q=${encodeURIComponent(providerQuery)}`).then(async (response) => {
        if (response.ok) setProviderOptions(await response.json());
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [providerQuery, draft.type]);

  function openCreatePanel() {
    setEditingId(null); setDraft(emptyDraft); setSelectedProvider(null); setProviderQuery("");
    setPanelOpen(true); setError(""); setNotice("");
  }

  function openEditPanel(campaign: Campaign) {
    setEditingId(campaign.id);
    setDraft({
      name: campaign.name, type: campaign.type ?? "GENERAL", placement: campaign.placement,
      headline: campaign.headline, supportingText: campaign.supportingText ?? "",
      ctaLabel: campaign.ctaLabel ?? "", destinationUrl: campaign.destinationUrl,
      priority: String(campaign.priority), startAt: campaign.startAt?.slice(0, 16) ?? "", endAt: campaign.endAt?.slice(0, 16) ?? "",
      advertiserServiceProviderId: "",
    });
    setSelectedProvider(campaign.advertiserProvider ? { id: "", displayName: campaign.advertiserProvider.displayName, type: "", verificationStatus: campaign.advertiserProvider.verificationStatus } : null);
    setPanelOpen(true); setError(""); setNotice("");
  }

  async function submitPanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice(""); setSaving(true);
    try {
      if (editingId) {
        const response = await fetch(`/api/platform-admin/campaigns/${editingId}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: draft.name, type: draft.type, headline: draft.headline,
            supportingText: draft.supportingText || undefined, ctaLabel: draft.ctaLabel || undefined,
            destinationUrl: draft.destinationUrl,
            advertiserServiceProviderId: selectedProvider?.id || undefined,
          }),
        });
        const body = await response.json();
        if (!response.ok) return setError(body.error?.message ?? "Unable to update that campaign.");
        setNotice("Campaign updated.");
      } else {
        const response = await fetch("/api/platform-admin/campaigns", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: draft.name, type: draft.type, placement: draft.placement, headline: draft.headline,
            supportingText: draft.supportingText || undefined, ctaLabel: draft.ctaLabel || undefined,
            destinationUrl: draft.destinationUrl, priority: Number(draft.priority || 0),
            startAt: draft.startAt || undefined, endAt: draft.endAt || undefined,
            advertiserServiceProviderId: selectedProvider?.id || undefined,
          }),
        });
        const body = await response.json();
        if (!response.ok) return setError(body.error?.message ?? "Unable to create that campaign.");
        setNotice("Campaign created as a draft/scheduled entry. Upload creative, then edit it here to attach a real provider if needed.");
        setEditingId(body.id);
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function uploadCreative(campaignId: string, slot: "desktop" | "mobile", file: File) {
    setError(""); setNotice("");
    const reader = new FileReader();
    const dataBase64: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/creative`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentType: file.type || "image/jpeg", dataBase64, mediaSlot: slot }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to upload that image.");
    setNotice(`${slot === "desktop" ? "Desktop" : "Mobile"} creative uploaded.`);
    await load();
  }

  async function duplicate(campaignId: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/duplicate`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to duplicate that campaign.");
    setNotice("Duplicated as a new draft.");
    await load();
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

  async function setStatus(campaignId: string, status: string, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/status`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update that campaign.");
    setNotice("Campaign updated."); await load();
  }

  async function schedule(event: FormEvent<HTMLFormElement>, campaignId: string) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/schedule`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startAt: form.get("startAt"), endAt: form.get("endAt") }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to schedule that campaign.");
    setNotice("Campaign scheduled."); await load();
  }

  const editingCampaign = editingId ? campaigns?.find((c) => c.id === editingId) ?? null : null;

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${statusFilter === tab.value ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
              key={tab.label}
              onClick={() => setStatusFilter(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-lg border p-2 text-sm" onChange={(event) => setPlacementFilter(event.target.value)} value={placementFilter}>
            <option value="">All placements</option>
            {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{PLACEMENT_LABELS[placement]}</option>)}
          </select>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-brand-hover" onClick={openCreatePanel} type="button">
            + Create Campaign
          </button>
        </div>
      </div>

      <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Placement</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Schedule</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Impressions</th>
              <th className="px-4 py-3">Clicks</th>
              <th className="px-4 py-3">CTR</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!campaigns ? (
              <tr><td className="px-4 py-6 text-slate-500" colSpan={10}>Loading…</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-500" colSpan={10}>No campaigns match this filter.</td></tr>
            ) : campaigns.map((campaign) => {
              const rate = ctr(campaign);
              return (
                <tr className="align-top" key={campaign.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{campaign.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{campaign.isPlatformOwned ? "UmoAfric" : campaign.advertiser?.displayName ?? campaign.advertiserProvider?.displayName ?? "Advertiser"}</p>
                    {campaign.rejectionReason && <p className="mt-1 text-xs text-red-600">Rejected: {campaign.rejectionReason}</p>}
                    {campaign.advertiserProvider && campaign.advertiserProvider.verificationStatus !== "VERIFIED" && (
                      <p className="mt-1 text-xs font-semibold text-amber-700">Provider not verified — will not appear publicly</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{PLACEMENT_LABELS[campaign.placement] ?? campaign.placement}</td>
                  <td className="px-4 py-3 text-slate-600">{campaign.type ? TYPE_LABELS[campaign.type] ?? campaign.type : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[campaign.status] ?? "bg-slate-100 text-slate-600"}`}>{campaign.status.replaceAll("_", " ")}</span>
                    {campaign.status === "APPROVED" && !campaign.startAt && <p className="mt-1 text-[11px] text-slate-500">Already live — Activate to unlock pause/end</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {campaign.startAt ? new Date(campaign.startAt).toLocaleDateString() : "—"} → {campaign.endAt ? new Date(campaign.endAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{campaign.priority}</td>
                  <td className="px-4 py-3 text-slate-600">{campaign.impressionCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{campaign.clickCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{rate === null ? "—" : `${rate.toFixed(1)}%`}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                      {campaign.status === "PENDING_APPROVAL" && <>
                        <button className="text-emerald-700" onClick={() => void review(campaign.id, "APPROVED")} type="button">Approve</button>
                        <button className="text-red-600" onClick={() => void review(campaign.id, "REJECTED")} type="button">Reject</button>
                      </>}
                      {["DRAFT", "APPROVED", "SCHEDULED", "PAUSED", "ACTIVE", "COMPLETED"].includes(campaign.status) && campaign.isPlatformOwned && (
                        <button className="text-slate-700" onClick={() => openEditPanel(campaign)} type="button">Edit</button>
                      )}
                      <button className="text-slate-500" onClick={() => void duplicate(campaign.id)} type="button">Duplicate</button>
                      {campaign.status === "APPROVED" && <button className="text-emerald-700" onClick={() => void setStatus(campaign.id, "ACTIVE")} type="button">Activate</button>}
                      {["SCHEDULED", "ACTIVE"].includes(campaign.status) && <button className="text-amber-700" onClick={() => void setStatus(campaign.id, "PAUSED")} type="button">Pause</button>}
                      {campaign.status === "PAUSED" && <button className="text-emerald-700" onClick={() => void setStatus(campaign.id, "ACTIVE")} type="button">Resume</button>}
                      {["ACTIVE", "PAUSED", "SCHEDULED"].includes(campaign.status) && <button className="text-slate-600" onClick={() => void setStatus(campaign.id, "COMPLETED", "End this campaign? It will stop appearing publicly, but its analytics are kept.")} type="button">End</button>}
                      {["COMPLETED", "REJECTED", "PAUSED", "DRAFT"].includes(campaign.status) && <button className="text-slate-500" onClick={() => void setStatus(campaign.id, "ARCHIVED", "Archive this campaign?")} type="button">Archive</button>}
                    </div>
                    {["APPROVED", "SCHEDULED"].includes(campaign.status) && (
                      <form className="mt-2 flex flex-wrap items-end gap-1.5 rounded-lg bg-slate-50 p-2" onSubmit={(event) => void schedule(event, campaign.id)}>
                        <label className="text-[11px] text-slate-600">Start<input className="mt-0.5 block rounded border p-1 text-[11px]" defaultValue={campaign.startAt?.slice(0, 16)} name="startAt" required type="datetime-local" /></label>
                        <label className="text-[11px] text-slate-600">End<input className="mt-0.5 block rounded border p-1 text-[11px]" defaultValue={campaign.endAt?.slice(0, 16)} name="endAt" required type="datetime-local" /></label>
                        <button className="rounded bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white" type="submit">Reschedule</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {panelOpen && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{editingId ? "Edit campaign" : "Create a UmoAfric-owned campaign"}</h2>
            <button className="text-sm font-semibold text-slate-500" onClick={() => setPanelOpen(false)} type="button">Close</button>
          </div>
          <p className="mt-1 text-sm text-slate-600">Homepage announcements and platform-curated marketplace placements — never a self-service submission.</p>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitPanel}>
              <input className="rounded border p-2 text-sm sm:col-span-2" onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Internal campaign name" required value={draft.name} />
              <select className="rounded border p-2 text-sm" onChange={(event) => setDraft({ ...draft, type: event.target.value })} value={draft.type}>
                {CAMPAIGN_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
              </select>
              <select className="rounded border p-2 text-sm disabled:bg-slate-100" disabled={!!editingId} onChange={(event) => setDraft({ ...draft, placement: event.target.value })} value={draft.placement}>
                {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{PLACEMENT_LABELS[placement]}</option>)}
              </select>

              {SERVICE_PROVIDER_TYPES.has(draft.type) && (
                <div className="grid gap-1.5 sm:col-span-2 rounded-lg border border-dashed p-3">
                  <p className="text-xs font-semibold text-slate-600">Property Service Professional / Company</p>
                  {selectedProvider ? (
                    <div className="flex items-center justify-between text-sm">
                      <span>{selectedProvider.displayName} {selectedProvider.verificationStatus !== "VERIFIED" && <span className="font-semibold text-amber-700">(not verified — will not appear publicly)</span>}</span>
                      <button className="text-xs font-semibold text-slate-500" onClick={() => setSelectedProvider(null)} type="button">Change</button>
                    </div>
                  ) : (
                    <>
                      <input className="rounded border p-2 text-sm" onChange={(event) => setProviderQuery(event.target.value)} placeholder="Search providers by name…" value={providerQuery} />
                      {providerOptions.length > 0 && (
                        <div className="grid gap-1">
                          {providerOptions.map((option) => (
                            <button className="flex items-center justify-between rounded border p-2 text-left text-sm hover:border-brand" key={option.id} onClick={() => { setSelectedProvider(option); setProviderOptions([]); }} type="button">
                              <span>{option.displayName}</span>
                              <span className={option.verificationStatus === "VERIFIED" ? "text-xs font-semibold text-emerald-700" : "text-xs text-slate-500"}>{option.verificationStatus}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <p className="text-[11px] text-slate-500">Only VERIFIED providers are ever shown publicly — this is enforced automatically regardless of what is selected here.</p>
                </div>
              )}

              <input className="rounded border p-2 text-sm sm:col-span-2" onChange={(event) => setDraft({ ...draft, headline: event.target.value })} placeholder="Headline" required value={draft.headline} />
              <input className="rounded border p-2 text-sm sm:col-span-2" onChange={(event) => setDraft({ ...draft, supportingText: event.target.value })} placeholder="Supporting text (optional)" value={draft.supportingText} />
              <input className="rounded border p-2 text-sm" onChange={(event) => setDraft({ ...draft, ctaLabel: event.target.value })} placeholder="CTA label (optional)" value={draft.ctaLabel} />
              <input className="rounded border p-2 text-sm" onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })} placeholder="https://…" required type="url" value={draft.destinationUrl} />
              {!editingId && <>
                <input className="rounded border p-2 text-sm" min={0} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} placeholder="Priority" type="number" value={draft.priority} />
                <div />
                <label className="text-xs text-slate-600">Start (optional)<input className="mt-1 block w-full rounded border p-2 text-sm" onChange={(event) => setDraft({ ...draft, startAt: event.target.value })} type="datetime-local" value={draft.startAt} /></label>
                <label className="text-xs text-slate-600">End (optional)<input className="mt-1 block w-full rounded border p-2 text-sm" onChange={(event) => setDraft({ ...draft, endAt: event.target.value })} type="datetime-local" value={draft.endAt} /></label>
              </>}
              <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white sm:col-span-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={saving} type="submit">
                {saving ? "Saving…" : editingId ? "Save changes" : "Create campaign"}
              </button>
            </form>

            <div className="grid content-start gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-600">Live preview</p>
                <div className="relative mt-2 h-40 overflow-hidden rounded-2xl border border-slate-200 bg-navy">
                  {editingCampaign?.desktopMediaUrl && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${editingCampaign.desktopMediaUrl}")` }} />}
                  <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-transparent" />
                  <div className="relative flex h-full max-w-xs flex-col justify-center gap-1.5 px-5 py-4">
                    <span className="w-fit rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-200">Promoted</span>
                    <h3 className="text-sm font-semibold text-white">{draft.headline || "Headline preview"}</h3>
                    {draft.supportingText && <p className="line-clamp-1 text-xs text-slate-200">{draft.supportingText}</p>}
                    {draft.ctaLabel && <span className="mt-1 w-fit rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-navy">{draft.ctaLabel}</span>}
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Approximate rendering in {PLACEMENT_LABELS[draft.placement]}.</p>
              </div>

              {editingId ? (
                <div className="grid gap-3">
                  <ImageSlot campaignId={editingId} currentUrl={editingCampaign?.desktopMediaUrl ?? null} label="Desktop creative" onUpload={(file) => void uploadCreative(editingId, "desktop", file)} recommended="Recommended 1600×640px, JPG or PNG" />
                  <ImageSlot campaignId={editingId} currentUrl={editingCampaign?.mobileMediaUrl ?? null} label="Mobile creative (optional)" onUpload={(file) => void uploadCreative(editingId, "mobile", file)} recommended="Recommended 800×640px, JPG or PNG" />
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-xs text-slate-500">Save the campaign first, then upload desktop/mobile creative here.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ImageSlot({ label, recommended, currentUrl, onUpload }: { campaignId: string; label: string; recommended: string; currentUrl: string | null; onUpload: (file: File) => void }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <p className="text-[11px] text-slate-500">{recommended}</p>
      {currentUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="mt-2 h-20 w-full rounded object-cover" src={currentUrl} />
      )}
      <input
        accept="image/*"
        className="mt-2 block w-full text-xs"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }}
        type="file"
      />
    </div>
  );
}
