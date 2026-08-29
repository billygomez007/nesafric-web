"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Canonical creative dimensions per placement, measured from the actual public
 * `MarketplaceCarousel` component (fixed 224px slide height inside a `max-w-7xl` container at
 * every breakpoint) — see `src/modules/campaigns/creative-spec.ts` for the full measurement
 * rationale. Duplicated here as plain data (rather than imported) because this file is a client
 * component and the source module is typed against generated Prisma enums not meant for the
 * client bundle; kept in sync by hand since placements rarely change.
 */
const CREATIVE_SPECS: Record<string, { desktop: { width: number; height: number }; mobile: { width: number; height: number }; measured: boolean }> = {
  MARKETPLACE_PRIMARY: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: true },
  MARKETPLACE_INLINE: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: true },
  DEVELOPMENT_FEATURED: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: false },
  PROFESSIONAL_FEATURED: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: false },
  SEARCH_FEATURED: { desktop: { width: 1600, height: 290 }, mobile: { width: 800, height: 500 }, measured: false },
};

function ratioLabel(dim: { width: number; height: number }) {
  return `${Math.round((dim.width / dim.height) * 10) / 10}:1`;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800",
  LIVE: "bg-emerald-50 text-emerald-800",
  SCHEDULED: "bg-sky-50 text-sky-800",
  PAUSED: "bg-amber-50 text-amber-800",
  ENDED: "bg-slate-100 text-slate-600",
  REJECTED: "bg-red-50 text-red-800",
  ARCHIVED: "bg-slate-100 text-slate-500",
};

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Live", value: "LIVE" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Draft", value: "DRAFT" },
  { label: "Paused", value: "PAUSED" },
  { label: "Ended", value: "ENDED" },
  { label: "Archived", value: "ARCHIVED" },
];

/** Whether a campaign is *actually* appearing publicly right now — the same rule the public
 * eligibility query enforces (status in APPROVED/SCHEDULED/ACTIVE, within its schedule window) —
 * rather than a naive "status === ACTIVE" check, so a SCHEDULED campaign whose start has already
 * arrived correctly shows as LIVE, and an ACTIVE campaign whose end has already passed correctly
 * shows as ENDED even before an admin explicitly marks it COMPLETED. */
function displayStatus(campaign: Campaign, now: Date): string {
  if (campaign.status === "ARCHIVED") return "ARCHIVED";
  if (campaign.status === "DRAFT") return "DRAFT";
  if (campaign.status === "PAUSED") return "PAUSED";
  if (campaign.status === "COMPLETED") return "ENDED";
  if (campaign.status === "PENDING_APPROVAL" || campaign.status === "REJECTED") return campaign.status;
  // APPROVED, SCHEDULED, or ACTIVE — resolve against the actual schedule window.
  const startAt = campaign.startAt ? new Date(campaign.startAt) : null;
  const endAt = campaign.endAt ? new Date(campaign.endAt) : null;
  if (startAt && startAt > now) return "SCHEDULED";
  if (endAt && endAt < now) return "ENDED";
  return "LIVE";
}

function ctr(campaign: Campaign) {
  if (!campaign.impressionCount) return null;
  return (campaign.clickCount / campaign.impressionCount) * 100;
}

const emptyDraft = {
  name: "", type: "GENERAL", placement: "MARKETPLACE_INLINE", headline: "", supportingText: "",
  ctaLabel: "", destinationUrl: "", priority: "0", startAt: "", endAt: "", advertiserServiceProviderId: "",
};

/** Renders a campaign's creative + headline/supporting text/CTA at the real measured aspect ratio
 * for the given device and placement, so "Live preview" and the standalone "Preview" action both
 * show something proportionally honest to how the public carousel actually renders — not just an
 * arbitrary decorative box. */
function CampaignPreview({
  placement, headline, supportingText, ctaLabel, desktopMediaUrl, mobileMediaUrl, device,
}: {
  placement: string; headline: string; supportingText: string; ctaLabel: string;
  desktopMediaUrl: string | null; mobileMediaUrl: string | null; device: "desktop" | "mobile";
}) {
  const spec = CREATIVE_SPECS[placement];
  const dim = device === "mobile" ? (spec?.mobile ?? { width: 800, height: 500 }) : (spec?.desktop ?? { width: 1600, height: 290 });
  const mediaUrl = device === "mobile" ? (mobileMediaUrl ?? desktopMediaUrl) : desktopMediaUrl;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-navy" style={{ aspectRatio: `${dim.width} / ${dim.height}` }}>
      <div className="relative h-full w-full">
        {mediaUrl && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${mediaUrl}")` }} />}
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/70 to-transparent" />
        <div className={`relative flex h-full flex-col justify-center gap-1.5 px-5 ${device === "mobile" ? "max-w-[85%]" : "max-w-md"}`}>
          <span className="w-fit rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-200">Promoted</span>
          <h3 className="text-sm font-semibold text-white sm:text-base">{headline || "Headline preview"}</h3>
          {supportingText && <p className="line-clamp-2 text-xs text-slate-200">{supportingText}</p>}
          {ctaLabel && <span className="mt-1 w-fit rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-navy">{ctaLabel}</span>}
        </div>
      </div>
    </div>
  );
}

/** A minimal, purpose-built confirmation modal — used instead of `window.confirm` so
 * Pause/End/Delete can show the exact multi-line explanatory copy and distinctly-labeled
 * confirm/cancel buttons the workflow requires, rather than a single generic OS-native string. */
function ConfirmDialog({
  title, description, confirmLabel, destructive, onConfirm, onCancel,
}: { title: string; description: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="font-semibold text-slate-950">{title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-lg border px-3.5 py-2 text-sm font-semibold text-slate-700" onClick={onCancel} type="button">Cancel</button>
          <button
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white ${destructive ? "bg-red-600" : "bg-navy"}`}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type PendingConfirm = { title: string; description: string; confirmLabel: string; destructive?: boolean; action: () => void };

export function CampaignsAdminContent() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [placementFilter, setPlacementFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [draftDevice, setDraftDevice] = useState<"desktop" | "mobile">("desktop");
  const [saving, setSaving] = useState(false);

  const [providerQuery, setProviderQuery] = useState("");
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null);

  async function load() {
    const response = await fetch("/api/platform-admin/campaigns");
    const body = await response.json();
    if (response.ok) setCampaigns(body.items);
    else setError(body.error?.message ?? "Unable to load campaigns.");
  }

  useEffect(() => {
    fetch("/api/platform-admin/campaigns").then(async (response) => {
      const body = await response.json();
      if (response.ok) setCampaigns(body.items);
      else setError(body.error?.message ?? "Unable to load campaigns.");
    });
  }, []);

  useEffect(() => {
    if (!SERVICE_PROVIDER_TYPES.has(draft.type)) return;
    const timer = setTimeout(() => {
      fetch(`/api/platform-admin/service-providers/search?q=${encodeURIComponent(providerQuery)}`).then(async (response) => {
        if (response.ok) setProviderOptions(await response.json());
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [providerQuery, draft.type]);

  const withDisplayStatus = useMemo(() => {
    const now = new Date();
    return (campaigns ?? []).map((campaign) => ({ campaign, status: displayStatus(campaign, now) }));
  }, [campaigns]);

  const visible = withDisplayStatus.filter(({ status }) => {
    if (statusFilter === "ALL") return status !== "ARCHIVED";
    return status === statusFilter;
  }).filter(({ campaign }) => !placementFilter || campaign.placement === placementFilter);

  const liveCampaigns = withDisplayStatus.filter(({ status }) => status === "LIVE").map(({ campaign }) => campaign);
  const liveByPlacement = liveCampaigns.reduce<Record<string, number>>((acc, campaign) => {
    acc[campaign.placement] = (acc[campaign.placement] ?? 0) + 1;
    return acc;
  }, {});

  function openCreatePanel() {
    setEditingId(null); setDraft(emptyDraft); setSelectedProvider(null); setProviderQuery(""); setDraftDevice("desktop");
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
    setDraftDevice("desktop");
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
        setNotice("Campaign created — it is already live (or scheduled, if you set a future start date). Upload creative below.");
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

  async function removeCreative(campaignId: string, slot: "desktop" | "mobile") {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/creative?slot=${slot}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to remove that image.");
    setNotice(`${slot === "desktop" ? "Desktop" : "Mobile"} creative removed.`);
    await load();
  }

  async function duplicate(campaignId: string) {
    setError(""); setNotice(""); setOpenMenuId(null);
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

  async function setStatus(campaignId: string, status: string) {
    setError(""); setNotice(""); setConfirm(null); setOpenMenuId(null);
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/status`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update that campaign.");
    setNotice("Campaign updated."); await load();
  }

  async function publish(campaignId: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/publish`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to publish that campaign.");
    setNotice("Campaign published — it is now live (or scheduled, if it has a future start date)."); await load();
  }

  async function deleteDraft(campaignId: string) {
    setError(""); setNotice(""); setConfirm(null);
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return setError(body.error?.message ?? "Unable to delete that draft.");
    }
    setNotice("Draft deleted."); await load();
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
  const draftSpec = CREATIVE_SPECS[draft.placement];

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-950">Campaigns</h1>
          <p className="text-sm text-slate-600">Manage promotional content across UmoAfric.</p>
        </div>
        <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:bg-brand-hover" onClick={openCreatePanel} type="button">
          + Create Campaign
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Currently live</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">{liveCampaigns.length} campaign{liveCampaigns.length === 1 ? "" : "s"}</p>
        {liveCampaigns.length > 0 ? (
          <ul className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
            {Object.entries(liveByPlacement).map(([placement, count]) => (
              <li key={placement}>{PLACEMENT_LABELS[placement] ?? placement}: <span className="font-semibold text-slate-950">{count}</span></li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Nothing is currently promoted publicly.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${statusFilter === tab.value ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select className="rounded-lg border p-2 text-sm" onChange={(event) => setPlacementFilter(event.target.value)} value={placementFilter}>
          <option value="">All placements</option>
          {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{PLACEMENT_LABELS[placement]}</option>)}
        </select>
      </div>

      <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3"></th>
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
              <tr><td className="px-4 py-6 text-slate-500" colSpan={11}>Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-500" colSpan={11}>No campaigns match this filter.</td></tr>
            ) : visible.map(({ campaign, status }) => {
              const rate = ctr(campaign);
              const thumb = campaign.desktopMediaUrl ?? campaign.mobileMediaUrl;
              return (
                <tr className="align-top" key={campaign.id}>
                  <td className="px-4 py-3">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="h-12 w-20 rounded-lg border border-slate-200 object-cover" src={thumb} />
                    ) : (
                      <div className="flex h-12 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[9px] text-slate-500">No image</div>
                    )}
                  </td>
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
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>{status.replaceAll("_", " ")}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {campaign.startAt ? new Date(campaign.startAt).toLocaleDateString() : "—"} → {campaign.endAt ? new Date(campaign.endAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{campaign.priority}</td>
                  <td className="px-4 py-3 text-slate-600">{campaign.impressionCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{campaign.clickCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{rate === null ? "—" : `${rate.toFixed(1)}%`}</td>
                  <td className="relative px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
                      {(status === "PENDING_APPROVAL") && <>
                        <button className="text-emerald-700" onClick={() => void review(campaign.id, "APPROVED")} type="button">Approve</button>
                        <button className="text-red-600" onClick={() => void review(campaign.id, "REJECTED")} type="button">Reject</button>
                      </>}
                      {status !== "PENDING_APPROVAL" && status !== "REJECTED" && (
                        <button className="text-slate-700" onClick={() => { setPreviewCampaign(campaign); setPreviewDevice("desktop"); }} type="button">Preview</button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED" || status === "PAUSED" || status === "DRAFT") && campaign.isPlatformOwned && (
                        <button className="text-slate-700" onClick={() => openEditPanel(campaign)} type="button">Edit</button>
                      )}
                      {status === "DRAFT" && (
                        <button className="text-emerald-700" onClick={() => void publish(campaign.id)} type="button">Publish</button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED") && (
                        <button
                          className="text-amber-700"
                          onClick={() => setConfirm({
                            title: "Pause this campaign?",
                            description: "It will immediately stop appearing in its public promotional placement. Campaign data and analytics will be preserved.",
                            confirmLabel: "Pause campaign",
                            action: () => setStatus(campaign.id, "PAUSED"),
                          })}
                          type="button"
                        >
                          Pause
                        </button>
                      )}
                      {status === "PAUSED" && (
                        <button className="text-emerald-700" onClick={() => void setStatus(campaign.id, "ACTIVE")} type="button">Resume</button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED" || status === "PAUSED") && (
                        <button
                          className="text-slate-600"
                          onClick={() => setConfirm({
                            title: "End this campaign?",
                            description: "Ending a campaign removes it from public placements while preserving its performance history.",
                            confirmLabel: "End campaign",
                            action: () => setStatus(campaign.id, "COMPLETED"),
                          })}
                          type="button"
                        >
                          End
                        </button>
                      )}
                      {status === "ENDED" && <>
                        <button className="text-slate-500" onClick={() => void duplicate(campaign.id)} type="button">Duplicate</button>
                        <button
                          className="text-slate-500"
                          onClick={() => setConfirm({
                            title: "Archive this campaign?",
                            description: "Archiving hides it from the normal Campaigns view. Its analytics and audit history are preserved and it will still appear under the Archived filter.",
                            confirmLabel: "Archive campaign",
                            action: () => setStatus(campaign.id, "ARCHIVED"),
                          })}
                          type="button"
                        >
                          Archive
                        </button>
                      </>}
                      {status === "DRAFT" && (
                        <button
                          className="text-red-600"
                          onClick={() => setConfirm({
                            title: "Delete this draft campaign permanently?",
                            description: "This action cannot be undone.",
                            confirmLabel: "Delete permanently",
                            destructive: true,
                            action: () => deleteDraft(campaign.id),
                          })}
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED" || status === "PAUSED") && (
                        <div className="relative">
                          <button className="text-slate-500" onClick={() => setOpenMenuId(openMenuId === campaign.id ? null : campaign.id)} type="button">•••</button>
                          {openMenuId === campaign.id && (
                            <div className="absolute right-0 top-6 z-10 w-36 rounded-lg border bg-white py-1 shadow-lg">
                              <button className="block w-full px-3 py-2 text-left font-normal text-slate-700 hover:bg-slate-50" onClick={() => void duplicate(campaign.id)} type="button">Duplicate</button>
                            </div>
                          )}
                        </div>
                      )}
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

      {confirm && (
        <ConfirmDialog
          confirmLabel={confirm.confirmLabel}
          description={confirm.description}
          destructive={confirm.destructive}
          onCancel={() => setConfirm(null)}
          onConfirm={confirm.action}
          title={confirm.title}
        />
      )}

      {previewCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-950">{previewCampaign.name}</h3>
              <button className="text-sm font-semibold text-slate-500" onClick={() => setPreviewCampaign(null)} type="button">Close</button>
            </div>
            <div className="mt-3 flex gap-2">
              <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${previewDevice === "desktop" ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600"}`} onClick={() => setPreviewDevice("desktop")} type="button">Desktop</button>
              <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${previewDevice === "mobile" ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600"}`} onClick={() => setPreviewDevice("mobile")} type="button">Mobile</button>
            </div>
            <div className="mt-3">
              <CampaignPreview
                ctaLabel={previewCampaign.ctaLabel ?? ""}
                desktopMediaUrl={previewCampaign.desktopMediaUrl}
                device={previewDevice}
                headline={previewCampaign.headline}
                mobileMediaUrl={previewCampaign.mobileMediaUrl}
                placement={previewCampaign.placement}
                supportingText={previewCampaign.supportingText ?? ""}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">Approximate rendering in {PLACEMENT_LABELS[previewCampaign.placement] ?? previewCampaign.placement}.</p>
          </div>
        </div>
      )}

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
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-600">Live preview</p>
                  <div className="flex gap-1.5">
                    <button className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${draftDevice === "desktop" ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600"}`} onClick={() => setDraftDevice("desktop")} type="button">Desktop</button>
                    <button className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${draftDevice === "mobile" ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600"}`} onClick={() => setDraftDevice("mobile")} type="button">Mobile</button>
                  </div>
                </div>
                <div className="mt-2">
                  <CampaignPreview
                    ctaLabel={draft.ctaLabel}
                    desktopMediaUrl={editingCampaign?.desktopMediaUrl ?? null}
                    device={draftDevice}
                    headline={draft.headline}
                    mobileMediaUrl={editingCampaign?.mobileMediaUrl ?? null}
                    placement={draft.placement}
                    supportingText={draft.supportingText}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Approximate rendering in {PLACEMENT_LABELS[draft.placement]}.</p>
              </div>

              {draftSpec && (
                <div className="rounded-lg border border-dashed p-3">
                  <p className="text-xs font-semibold text-slate-700">Creative specification</p>
                  <p className="mt-1 text-xs text-slate-600">Desktop: <span className="font-semibold text-slate-950">{draftSpec.desktop.width} × {draftSpec.desktop.height}px</span> ({ratioLabel(draftSpec.desktop)})</p>
                  <p className="text-xs text-slate-600">Mobile: <span className="font-semibold text-slate-950">{draftSpec.mobile.width} × {draftSpec.mobile.height}px</span> ({ratioLabel(draftSpec.mobile)})</p>
                  {!draftSpec.measured && <p className="mt-1 text-[11px] text-amber-700">This placement has no live public page yet — this spec is a provisional default.</p>}
                </div>
              )}

              {editingId ? (
                <div className="grid gap-3">
                  <p className="text-xs font-semibold text-slate-700">Promotional creative</p>
                  <ImageSlot
                    currentUrl={editingCampaign?.desktopMediaUrl ?? null}
                    label="Desktop carousel image"
                    onRemove={() => void removeCreative(editingId, "desktop")}
                    onUpload={(file) => void uploadCreative(editingId, "desktop", file)}
                    spec={draftSpec?.desktop ?? { width: 1600, height: 290 }}
                  />
                  <ImageSlot
                    currentUrl={editingCampaign?.mobileMediaUrl ?? null}
                    label="Mobile carousel image (optional — falls back to desktop image)"
                    onRemove={() => void removeCreative(editingId, "mobile")}
                    onUpload={(file) => void uploadCreative(editingId, "mobile", file)}
                    spec={draftSpec?.mobile ?? { width: 800, height: 500 }}
                  />
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-xs text-slate-500">Create the campaign first, then upload desktop/mobile creative here.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ImageSlot({
  label, spec, currentUrl, onUpload, onRemove,
}: { label: string; spec: { width: number; height: number }; currentUrl: string | null; onUpload: (file: File) => void; onRemove: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [warning, setWarning] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function checkDimensions(file: File) {
    return new Promise<void>((resolve) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = image.width / image.height;
        const recommendedRatio = spec.width / spec.height;
        if (Math.abs(ratio - recommendedRatio) / recommendedRatio > 0.15) {
          setWarning(
            `This image is ${image.width} × ${image.height}px. For this placement, we recommend ${spec.width} × ${spec.height}px (${ratioLabel(spec)}). Upload another image, or continue — the image will be cropped to fit rather than stretched.`,
          );
        } else {
          setWarning("");
        }
        resolve();
      };
      image.onerror = () => resolve();
      image.src = url;
    });
  }

  async function handleFile(file: File) {
    await checkDimensions(file);
    onUpload(file);
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <p className="text-[11px] text-slate-500">Recommended: {spec.width} × {spec.height}px · Aspect ratio {ratioLabel(spec)}</p>
      {currentUrl && (
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="h-14 w-24 rounded object-cover" src={currentUrl} />
          <div className="flex flex-col gap-1 text-[11px] font-semibold">
            <button className="text-left text-slate-700" onClick={() => inputRef.current?.click()} type="button">Replace image</button>
            <button className="text-left text-red-600" onClick={onRemove} type="button">Remove image</button>
          </div>
        </div>
      )}
      <div
        className={`mt-2 grid place-items-center rounded-lg border-2 border-dashed p-4 text-center text-xs ${dragOver ? "border-brand bg-brand/5" : "border-slate-300"}`}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        <p className="text-slate-600">Drag & drop image here</p>
        <p className="my-1 text-slate-500">or</p>
        <button className="rounded-lg border px-3 py-1.5 font-semibold text-slate-700" onClick={() => inputRef.current?.click()} type="button">Browse files</button>
        <p className="mt-2 text-slate-500">PNG • JPG • WEBP · Maximum 5MB</p>
        <input
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }}
          ref={inputRef}
          type="file"
        />
      </div>
      {warning && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">{warning}</p>}
    </div>
  );
}
