"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Campaign = {
  id: string; name: string; placement: string; type: string | null; status: string; priority: number;
  headline: string; supportingText: string | null; ctaLabel: string | null; destinationUrl: string;
  desktopMediaUrl: string | null; mobileMediaUrl: string | null; nativeAppMediaUrl: string | null;
  isPlatformOwned: boolean; impressionCount: number; clickCount: number;
  advertiser: { displayName: string; slug: string } | null;
  advertiserProvider: { displayName: string; slug: string; verificationStatus: string } | null;
  rejectionReason: string | null; startAt: string | null; endAt: string | null;
  /** Server-computed with the public carousel rules (`src/modules/campaigns/eligibility.ts`). */
  publicEligibility: { eligible: boolean; reason: string | null };
  creativeReadiness: { note: string | null };
};
type ProviderOption = { id: string; displayName: string; type: string; verificationStatus: string };

// Labels name where each placement actually renders. MARKETPLACE_PRIMARY is the homepage
// advertising carousel on the website and in the native app; MARKETPLACE_INLINE is the carousel
// on the property search page. (These were once swapped, which sent "carousel" campaigns to the
// search page instead of the homepage and app.)
const PLACEMENT_LABELS: Record<string, string> = {
  MARKETPLACE_PRIMARY: "Homepage Advertising Carousel (web + app)",
  MARKETPLACE_INLINE: "Property Search Carousel",
  HOMEPAGE_ANNOUNCEMENT: "Homepage Announcement Bar",
  PROFESSIONAL_FEATURED: "Professional Directory",
  DEVELOPMENT_FEATURED: "Development Feature (not yet public)",
  SEARCH_FEATURED: "Search Results Feature (not yet public)",
};
const PLACEMENTS = Object.keys(PLACEMENT_LABELS);

const PLACEMENT_DESCRIPTIONS: Record<string, string> = {
  HOMEPAGE_ANNOUNCEMENT: "Thin NesAfric-owned announcement bar on the corporate homepage. Text only — no promotional image is used.",
  MARKETPLACE_PRIMARY: "The advertising carousel below the search on the nesafric.com homepage and on the NesAfric app home screen.",
  MARKETPLACE_INLINE: "Carousel at the top of the property search page on nesafric.com.",
  PROFESSIONAL_FEATURED: "Banner on the professional directory for real estate professionals and companies.",
  DEVELOPMENT_FEATURED: "Reserved for property developments. Not shown publicly yet.",
  SEARCH_FEATURED: "Reserved for promoted search results. Not shown publicly yet.",
};

const CTA_PRESETS = [
  "Explore Properties",
  "View Property",
  "View Development",
  "View Company",
  "View Professional",
  "Explore Services",
  "Learn More",
  "Contact",
  "Book Now",
  "Get Started",
];

const TYPE_LABELS: Record<string, string> = {
  PROPERTY: "Property",
  DEVELOPMENT: "Development",
  REAL_ESTATE_PROFESSIONAL: "Real Estate Professional",
  REAL_ESTATE_COMPANY: "Real Estate Company",
  PROPERTY_SERVICE_PROFESSIONAL: "Property Service Professional",
  PROPERTY_SERVICE_COMPANY: "Property Service Company",
  UMOAFRIC_PROMOTION: "NesAfric Promotion",
  ANNOUNCEMENT: "Announcement",
  GENERAL: "General / Sponsored",
};
const CAMPAIGN_TYPES = Object.keys(TYPE_LABELS);
const SERVICE_PROVIDER_TYPES = new Set(["PROPERTY_SERVICE_PROFESSIONAL", "PROPERTY_SERVICE_COMPANY"]);

/**
 * Campaign-admin upload canvases.
 *
 * Current recommended artwork sizes:
 *   - Desktop web: 1600 x 220
 *   - Mobile web: 800 x 320
 *   - Native mobile app: 1200 x 792
 *
 * The web carousel is responsive and uses cover-style cropping, so important
 * visual content should remain inside a safe central area.
 *
 * Keep these client-side values synchronized with
 * `src/modules/campaigns/creative-spec.ts`.
 */
const CREATIVE_SPECS: Record<string, { desktop: { width: number; height: number }; mobile: { width: number; height: number }; nativeApp: { width: number; height: number }; measured: boolean }> = {
  MARKETPLACE_PRIMARY: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 792 }, measured: true },
  MARKETPLACE_INLINE: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 792 }, measured: true },
  DEVELOPMENT_FEATURED: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 792 }, measured: false },
  PROFESSIONAL_FEATURED: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 792 }, measured: false },
  SEARCH_FEATURED: { desktop: { width: 1600, height: 220 }, mobile: { width: 800, height: 320 }, nativeApp: { width: 1200, height: 792 }, measured: false },
};

function ratioLabel(dim: { width: number; height: number }) {
  return `${Math.round((dim.width / dim.height) * 10) / 10}:1`;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-surface text-ink",
  PENDING_APPROVAL: "bg-gold/10 text-ink",
  LIVE: "bg-teal/10 text-teal",
  SCHEDULED: "bg-teal/10 text-teal",
  PAUSED: "bg-gold/10 text-ink",
  ENDED: "bg-surface text-muted",
  REJECTED: "bg-red-50 text-red-800",
  ARCHIVED: "bg-surface text-muted",
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

/** `datetime-local` values are in the admin's own time zone; the API stores UTC instants. */
function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function ctr(campaign: Campaign) {
  if (!campaign.impressionCount) return null;
  return (campaign.clickCount / campaign.impressionCount) * 100;
}

const emptyDraft = {
  name: "", type: "GENERAL", placement: "MARKETPLACE_PRIMARY", headline: "", supportingText: "",
  ctaLabel: "", destinationUrl: "", priority: "0", startAt: "", endAt: "", advertiserServiceProviderId: "",
};

/** Renders a campaign's creative (or, with no artwork, its headline/supporting text/CTA) at the real measured aspect ratio
 * for the given device and placement, so "Live preview" and the standalone "Preview" action both
 * show something proportionally honest to how the public carousel actually renders — not just an
 * arbitrary decorative box. */
function CampaignPreview({
  placement, headline, supportingText, ctaLabel, desktopMediaUrl, mobileMediaUrl, nativeAppMediaUrl, device,
}: {
  placement: string; headline: string; supportingText: string; ctaLabel: string;
  desktopMediaUrl: string | null; mobileMediaUrl: string | null; nativeAppMediaUrl: string | null; device: "desktop" | "mobile" | "nativeApp";
}) {
  const spec = CREATIVE_SPECS[placement];
  const dim =
    device === "nativeApp"
      ? (spec?.nativeApp ?? { width: 1200, height: 792 })
      : device === "mobile"
        ? (spec?.mobile ?? { width: 800, height: 320 })
        : (spec?.desktop ?? { width: 1600, height: 220 });
  const mediaUrl =
    device === "nativeApp"
      ? (nativeAppMediaUrl ?? mobileMediaUrl ?? desktopMediaUrl)
      : device === "mobile"
        ? (mobileMediaUrl ?? desktopMediaUrl)
        : desktopMediaUrl;

  if (placement === "HOMEPAGE_ANNOUNCEMENT") {
    return (
      <div className="overflow-hidden rounded-xl border border-hairline bg-forest text-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">NesAfric Announcement</p>
            <p className="mt-1 text-sm font-semibold">{headline || "Announcement headline preview"}</p>
            {supportingText && <p className="mt-1 text-xs leading-5 text-white/70">{supportingText}</p>}
          </div>
          {ctaLabel && (
            <span className="w-fit shrink-0 rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-forest">
              {ctaLabel}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-forest" style={{ aspectRatio: `${dim.width} / ${dim.height}` }}>
      <div className="relative h-full w-full">
        {/* Same rule as the public carousels: uploaded artwork is the finished creative and is
            shown as-is. The headline, copy and CTA only render when there is no artwork. */}
        {mediaUrl ? (
          <div className="absolute inset-0 bg-cover bg-center" role="img" aria-label={headline || "Campaign artwork"} style={{ backgroundImage: `url("${mediaUrl}")` }} />
        ) : (
          <div className={`relative flex h-full flex-col justify-center gap-1.5 px-5 ${device === "mobile" ? "max-w-[85%]" : "max-w-md"}`}>
            <h3 className="text-sm font-semibold text-white sm:text-base">{headline || "Headline preview"}</h3>
            {supportingText && <p className="line-clamp-2 text-xs text-white/75">{supportingText}</p>}
            {ctaLabel && <span className="mt-1 w-fit rounded-lg bg-gold px-2.5 py-1 text-xs font-semibold text-forest">{ctaLabel}</span>}
          </div>
        )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-card">
        <h3 className="font-semibold text-forest">{title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-muted">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-lg border px-3.5 py-2 text-sm font-semibold text-ink" onClick={onCancel} type="button">Cancel</button>
          <button
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white ${destructive ? "bg-red-600" : "bg-forest"}`}
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
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile" | "nativeApp">("desktop");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [draftDevice, setDraftDevice] = useState<"desktop" | "mobile" | "nativeApp">("desktop");
  const [saving, setSaving] = useState(false);

  const [providerQuery, setProviderQuery] = useState("");
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null);

  const [stagedDesktop, setStagedDesktop] = useState<File | null>(null);
  const [stagedMobile, setStagedMobile] = useState<File | null>(null);
  const [stagedNativeApp, setStagedNativeApp] = useState<File | null>(null);
  const [stagedDesktopPreview, setStagedDesktopPreview] = useState<string | null>(null);
  const [stagedMobilePreview, setStagedMobilePreview] = useState<string | null>(null);
  const [stagedNativeAppPreview, setStagedNativeAppPreview] = useState<string | null>(null);

  /** Selects a file for a campaign that doesn't exist yet — held client-side (with an instant
   * local object-URL preview) until the campaign is actually created, since the upload endpoint
   * requires a real campaign id. Superseded object URLs are revoked immediately to avoid leaking
   * memory across repeated selections. */
  function stageFile(slot: "desktop" | "mobile" | "nativeApp", file: File) {
    const url = URL.createObjectURL(file);
    if (slot === "desktop") {
      setStagedDesktop(file);
      setStagedDesktopPreview((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
    } else if (slot === "mobile") {
      setStagedMobile(file);
      setStagedMobilePreview((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
    } else {
      setStagedNativeApp(file);
      setStagedNativeAppPreview((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
    }
  }

  function clearStaged(slot: "desktop" | "mobile" | "nativeApp") {
    if (slot === "desktop") {
      setStagedDesktopPreview((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
      setStagedDesktop(null);
    } else if (slot === "mobile") {
      setStagedMobilePreview((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
      setStagedMobile(null);
    } else {
      setStagedNativeAppPreview((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
      setStagedNativeApp(null);
    }
  }

  async function load() {
    try {
      const response = await fetch("/api/platform-admin/campaigns");
      const body = await response.json();
      // On failure the table must not stay stuck on "Loading…" forever alongside the error
      // banner — settle it to an empty list so the UI reaches a clean, legible state either way.
      if (response.ok) setCampaigns(body.items);
      else { setError(body.error?.message ?? "Unable to load campaigns."); setCampaigns([]); }
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
      setCampaigns([]);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount; `load` is also reused after every mutation below, so it must stay async rather than being restructured just for this one call site.
    void load();
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

  const scheduledCampaigns = withDisplayStatus.filter(({ status }) => status === "SCHEDULED").length;
  const draftCampaigns = withDisplayStatus.filter(({ status }) => status === "DRAFT").length;
  const totalImpressions = (campaigns ?? []).reduce((total, campaign) => total + campaign.impressionCount, 0);
  const totalClicks = (campaigns ?? []).reduce((total, campaign) => total + campaign.clickCount, 0);
  const overallCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;

  function openCreatePanel() {
    clearStaged("desktop"); clearStaged("mobile"); clearStaged("nativeApp");
    setEditingId(null); setDraft(emptyDraft); setSelectedProvider(null); setProviderQuery(""); setDraftDevice("desktop");
    setPanelOpen(true); setError(""); setNotice("");
  }

  function openEditPanel(campaign: Campaign) {
    clearStaged("desktop"); clearStaged("mobile"); clearStaged("nativeApp");
    setEditingId(campaign.id);
    setDraft({
      name: campaign.name, type: campaign.type ?? "GENERAL", placement: campaign.placement,
      headline: campaign.headline, supportingText: campaign.supportingText ?? "",
      ctaLabel: campaign.ctaLabel ?? "", destinationUrl: campaign.destinationUrl,
      priority: String(campaign.priority), startAt: toLocalInput(campaign.startAt), endAt: toLocalInput(campaign.endAt),
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
            name: draft.name, type: draft.type, placement: draft.placement, headline: draft.headline,
            supportingText: draft.supportingText || undefined, ctaLabel: draft.ctaLabel || undefined,
            destinationUrl: draft.destinationUrl,
            advertiserServiceProviderId: selectedProvider?.id || undefined,
          }),
        });
        const body = await response.json();
        if (!response.ok) return setError(body.error?.message ?? "Unable to update that campaign.");
        setNotice("Campaign updated.");
      } else {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const intent = submitter?.value === "publish" ? "publish" : "draft";
        const response = await fetch("/api/platform-admin/campaigns", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: draft.name, type: draft.type, placement: draft.placement, headline: draft.headline,
            supportingText: draft.supportingText || undefined, ctaLabel: draft.ctaLabel || undefined,
            destinationUrl: draft.destinationUrl, priority: Number(draft.priority || 0),
            startAt: fromLocalInput(draft.startAt), endAt: fromLocalInput(draft.endAt),
            advertiserServiceProviderId: selectedProvider?.id || undefined,
            saveAsDraft: true,
          }),
        });
        const body = await response.json();
        if (!response.ok) return setError(body.error?.message ?? "Unable to create that campaign.");
        const newId: string = body.id;
        setEditingId(newId);

        // Attach any creative selected before creation now that a real campaign id exists. Kept
        // as DRAFT throughout this step deliberately (see `saveAsDraft` above) — a campaign whose
        // upload fails here must never have already gone live with a missing/broken image.
        let uploadFailed = false;
        if (stagedDesktop) uploadFailed = !(await uploadCreative(newId, "desktop", stagedDesktop, { silent: true })) || uploadFailed;
        if (!uploadFailed && stagedMobile) uploadFailed = !(await uploadCreative(newId, "mobile", stagedMobile, { silent: true })) || uploadFailed;
        if (!uploadFailed && stagedNativeApp) uploadFailed = !(await uploadCreative(newId, "nativeApp", stagedNativeApp, { silent: true })) || uploadFailed;
        clearStaged("desktop"); clearStaged("mobile"); clearStaged("nativeApp");

        if (uploadFailed) {
          setError("Campaign was saved as a draft, but the creative could not be uploaded. Please retry the image upload.");
          await load();
          return;
        }

        if (intent === "publish") {
          const publishResponse = await fetch(`/api/platform-admin/campaigns/${newId}/publish`, { method: "POST" });
          const publishBody = await publishResponse.json();
          if (!publishResponse.ok) {
            setError(publishBody.error?.message ?? "Campaign was saved as a draft, but could not be published. Publish it from the campaign list when ready.");
            await load();
            return;
          }
          setNotice("Campaign created and published — it is now live (or scheduled, if it has a future start date).");
        } else {
          setNotice("Campaign saved as a draft.");
        }
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function uploadCreative(campaignId: string, slot: "desktop" | "mobile" | "nativeApp", file: File, options?: { silent?: boolean }) {
    if (!options?.silent) { setError(""); setNotice(""); }
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
    if (!response.ok) {
      if (!options?.silent) setError(body.error?.message ?? "Unable to upload that image.");
      return false;
    }
    if (!options?.silent) {
      setNotice(body.dimensionWarning ? `${slot === "desktop" ? "Desktop" : slot === "mobile" ? "Mobile web" : "Native app"} creative uploaded. ${body.dimensionWarning}` : `${slot === "desktop" ? "Desktop" : slot === "mobile" ? "Mobile web" : "Native app"} creative uploaded.`);
      await load();
    }
    return true;
  }

  async function removeCreative(campaignId: string, slot: "desktop" | "mobile" | "nativeApp") {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/campaigns/${campaignId}/creative?slot=${slot}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to remove that image.");
    setNotice(`${slot === "desktop" ? "Desktop" : slot === "mobile" ? "Mobile web" : "Native app"} creative removed.`);
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
      {notice && <p className="rounded-lg bg-teal/10 p-3 text-sm text-teal">{notice}</p>}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">Marketplace growth operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-forest">Campaigns</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Create, schedule, publish and measure NesAfric-owned promotional placements across the marketplace ecosystem.</p>
        </div>
        <button className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-forest transition-colors hover:bg-gold-hover" onClick={openCreatePanel} type="button">
          + Create Campaign
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Live campaigns</p>
          <p className="mt-2 text-2xl font-semibold text-forest">{liveCampaigns.length}</p>
          <p className="mt-1 text-xs text-muted">Currently visible publicly</p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Scheduled</p>
          <p className="mt-2 text-2xl font-semibold text-forest">{scheduledCampaigns}</p>
          <p className="mt-1 text-xs text-muted">Waiting for their start window</p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Drafts</p>
          <p className="mt-2 text-2xl font-semibold text-forest">{draftCampaigns}</p>
          <p className="mt-1 text-xs text-muted">Not publicly visible</p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Impressions</p>
          <p className="mt-2 text-2xl font-semibold text-forest">{totalImpressions.toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted">Across all campaign history</p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">Overall CTR</p>
          <p className="mt-2 text-2xl font-semibold text-forest">{overallCtr === null ? "—" : `${overallCtr.toFixed(1)}%`}</p>
          <p className="mt-1 text-xs text-muted">{totalClicks.toLocaleString()} total clicks</p>
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">Live placement inventory</p>
            <h2 className="mt-1 font-semibold text-forest">What NesAfric is promoting now</h2>
          </div>
          <p className="text-xs text-muted">{liveCampaigns.length} active placement{liveCampaigns.length === 1 ? "" : "s"}</p>
        </div>

        {liveCampaigns.length > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(liveByPlacement).map(([placement, count]) => (
              <div className="flex items-center justify-between rounded-xl border border-hairline bg-warm-white px-3 py-3" key={placement}>
                <span className="text-sm text-ink">{PLACEMENT_LABELS[placement] ?? placement}</span>
                <span className="rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-hairline bg-warm-white p-5">
            <p className="text-sm font-semibold text-forest">No campaigns are currently live.</p>
            <p className="mt-1 text-xs leading-5 text-muted">Create or publish a campaign to begin using NesAfric promotional inventory.</p>
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${statusFilter === tab.value ? "border-forest bg-forest text-white" : "border-hairline text-muted hover:border-hairline"}`}
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
          <select className="rounded-xl border border-hairline bg-white p-2 text-sm text-ink" onChange={(event) => setPlacementFilter(event.target.value)} value={placementFilter}>
            <option value="">All placements</option>
            {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{PLACEMENT_LABELS[placement]}</option>)}
          </select>
        </div>
      </div>

      <section className="overflow-x-auto rounded-2xl border border-hairline bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-warm-white text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3"></th>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Placement</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Public visibility</th>
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
              <tr><td className="px-4 py-10 text-center text-sm text-muted" colSpan={12}>Loading campaign operations…</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td className="px-4 py-12 text-center" colSpan={12}><p className="font-semibold text-forest">No campaigns yet</p><p className="mt-1 text-sm text-muted">Create the first NesAfric-owned promotion to start using campaign inventory.</p></td></tr>
            ) : visible.length === 0 ? (
              <tr><td className="px-4 py-10 text-center" colSpan={12}><p className="font-semibold text-forest">No matching campaigns</p><p className="mt-1 text-sm text-muted">Change the status or placement filter to see other campaign records.</p></td></tr>
            ) : visible.map(({ campaign, status }) => {
              const rate = ctr(campaign);
              const thumb = campaign.desktopMediaUrl ?? campaign.mobileMediaUrl;
              return (
                <tr className="align-top" key={campaign.id}>
                  <td className="px-4 py-3">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="h-12 w-20 rounded-lg border border-hairline object-cover" src={thumb} />
                    ) : (
                      <div className="flex h-12 w-20 items-center justify-center rounded-lg border border-dashed border-hairline bg-warm-white text-[9px] text-muted">No image</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-forest">{campaign.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{campaign.isPlatformOwned ? "NesAfric" : campaign.advertiser?.displayName ?? campaign.advertiserProvider?.displayName ?? "Advertiser"}</p>
                    {campaign.rejectionReason && <p className="mt-1 text-xs text-red-600">Rejected: {campaign.rejectionReason}</p>}
                    {campaign.advertiserProvider && campaign.advertiserProvider.verificationStatus !== "VERIFIED" && (
                      <p className="mt-1 text-xs font-semibold text-ink">Provider not verified — will not appear publicly</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{PLACEMENT_LABELS[campaign.placement] ?? campaign.placement}</td>
                  <td className="px-4 py-3 text-muted">{campaign.type ? TYPE_LABELS[campaign.type] ?? campaign.type : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-surface text-muted"}`}>{status.replaceAll("_", " ")}</span>
                  </td>
                  <td className="max-w-[15rem] px-4 py-3 text-xs" data-testid={`campaign-visibility-${campaign.id}`}>
                    {campaign.publicEligibility.eligible ? (
                      <p className="font-semibold text-teal">Showing in {PLACEMENT_LABELS[campaign.placement] ?? campaign.placement}</p>
                    ) : (
                      <p className="font-semibold text-ink">Not currently showing: <span className="font-normal">{campaign.publicEligibility.reason}</span></p>
                    )}
                    {campaign.creativeReadiness.note && <p className="mt-1 leading-5 text-muted">{campaign.creativeReadiness.note}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {campaign.startAt ? new Date(campaign.startAt).toLocaleDateString() : "—"} → {campaign.endAt ? new Date(campaign.endAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">{campaign.priority}</td>
                  <td className="px-4 py-3 text-muted">{campaign.impressionCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-muted">{campaign.clickCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-muted">{rate === null ? "—" : `${rate.toFixed(1)}%`}</td>
                  <td className="relative px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
                      {(status === "PENDING_APPROVAL") && <>
                        <button className="text-teal" onClick={() => void review(campaign.id, "APPROVED")} type="button">Approve</button>
                        <button className="text-red-600" onClick={() => void review(campaign.id, "REJECTED")} type="button">Reject</button>
                      </>}
                      {status !== "PENDING_APPROVAL" && status !== "REJECTED" && (
                        <button className="text-ink" onClick={() => { setPreviewCampaign(campaign); setPreviewDevice("desktop"); }} type="button">Preview</button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED" || status === "PAUSED" || status === "DRAFT") && campaign.isPlatformOwned && (
                        <button className="text-ink" onClick={() => openEditPanel(campaign)} type="button">Edit</button>
                      )}
                      {status === "DRAFT" && (
                        <button className="text-teal" onClick={() => void publish(campaign.id)} type="button">Publish</button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED") && (
                        <button
                          className="text-ink"
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
                        <button className="text-teal" onClick={() => void setStatus(campaign.id, "ACTIVE")} type="button">Resume</button>
                      )}
                      {(status === "LIVE" || status === "SCHEDULED" || status === "PAUSED") && (
                        <button
                          className="text-muted"
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
                        <button className="text-muted" onClick={() => void duplicate(campaign.id)} type="button">Duplicate</button>
                        <button
                          className="text-muted"
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
                          <button className="text-muted" onClick={() => setOpenMenuId(openMenuId === campaign.id ? null : campaign.id)} type="button">•••</button>
                          {openMenuId === campaign.id && (
                            <div className="absolute right-0 top-6 z-10 w-36 rounded-lg border bg-white py-1 shadow-lg">
                              <button className="block w-full px-3 py-2 text-left font-normal text-ink hover:bg-warm-white" onClick={() => void duplicate(campaign.id)} type="button">Duplicate</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {["APPROVED", "SCHEDULED"].includes(campaign.status) && (
                      <form className="mt-2 flex flex-wrap items-end gap-1.5 rounded-lg bg-warm-white p-2" onSubmit={(event) => void schedule(event, campaign.id)}>
                        <label className="text-[11px] text-muted">Start<input className="mt-0.5 block rounded-xl border border-hairline p-1 text-[11px]" defaultValue={campaign.startAt?.slice(0, 16)} name="startAt" required type="datetime-local" /></label>
                        <label className="text-[11px] text-muted">End<input className="mt-0.5 block rounded-xl border border-hairline p-1 text-[11px]" defaultValue={campaign.endAt?.slice(0, 16)} name="endAt" required type="datetime-local" /></label>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest/50 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-card">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-forest">{previewCampaign.name}</h3>
              <button className="text-sm font-semibold text-muted" onClick={() => setPreviewCampaign(null)} type="button">Close</button>
            </div>
            <div className="mt-3 flex gap-2">
              <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${previewDevice === "desktop" ? "border-forest bg-forest text-white" : "border-hairline text-muted"}`} onClick={() => setPreviewDevice("desktop")} type="button">Desktop</button>
              <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${previewDevice === "mobile" ? "border-forest bg-forest text-white" : "border-hairline text-muted"}`} onClick={() => setPreviewDevice("mobile")} type="button">Mobile</button>
              <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${previewDevice === "nativeApp" ? "border-forest bg-forest text-white" : "border-hairline text-muted"}`} onClick={() => setPreviewDevice("nativeApp")} type="button">Native App</button>
            </div>
            <div className="mt-3">
              <CampaignPreview
                ctaLabel={previewCampaign.ctaLabel ?? ""}
                desktopMediaUrl={previewCampaign.desktopMediaUrl}
                device={previewDevice}
                headline={previewCampaign.headline}
                mobileMediaUrl={previewCampaign.mobileMediaUrl}
                nativeAppMediaUrl={previewCampaign.nativeAppMediaUrl}
                placement={previewCampaign.placement}
                supportingText={previewCampaign.supportingText ?? ""}
              />
            </div>
            <p className="mt-2 text-xs text-muted">Approximate rendering in {PLACEMENT_LABELS[previewCampaign.placement] ?? previewCampaign.placement}.</p>
          </div>
        </div>
      )}

      {panelOpen && (
        <section className="rounded-xl border bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">NesAfric campaign operations</p>
              <h2 className="mt-1 text-lg font-semibold text-forest">{editingId ? "Edit campaign" : "Create a NesAfric-owned campaign"}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Create homepage announcements and platform-curated marketplace promotions. Public placement remains controlled by NesAfric and is never a self-service publishing surface.</p>
            </div>
            <button className="rounded-lg border border-hairline px-3 py-2 text-sm font-semibold text-muted hover:text-forest" onClick={() => setPanelOpen(false)} type="button">Close</button>
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitPanel}>
              <div className="sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">1. Campaign setup</p>
                <p className="mt-1 text-xs leading-5 text-muted">Define what this campaign is and where NesAfric will surface it.</p>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-ink sm:col-span-2">
                Internal campaign name
                <input className="rounded-xl border border-hairline p-2.5 text-sm font-normal" onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Accra Luxury Developments — October" required value={draft.name} />
              </label>
              <select className="rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setDraft({ ...draft, type: event.target.value })} value={draft.type}>
                {CAMPAIGN_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
              </select>
              <select aria-label="Placement" className="rounded-xl border border-hairline p-2 text-sm disabled:bg-surface" onChange={(event) => setDraft({ ...draft, placement: event.target.value })} value={draft.placement}>
                {PLACEMENTS.map((placement) => <option key={placement} value={placement}>{PLACEMENT_LABELS[placement]}</option>)}
              </select>
              <div className="rounded-xl border border-hairline bg-warm-white p-3 text-xs sm:col-span-2">
                <p className="font-semibold text-forest">{PLACEMENT_LABELS[draft.placement]}</p>
                <p className="mt-1 leading-5 text-muted">{PLACEMENT_DESCRIPTIONS[draft.placement]}</p>
              </div>

              {SERVICE_PROVIDER_TYPES.has(draft.type) && (
                <div className="grid gap-1.5 sm:col-span-2 rounded-lg border border-dashed p-3">
                  <p className="text-xs font-semibold text-muted">Property Service Professional / Company</p>
                  {selectedProvider ? (
                    <div className="flex items-center justify-between text-sm">
                      <span>{selectedProvider.displayName} {selectedProvider.verificationStatus !== "VERIFIED" && <span className="font-semibold text-ink">(not verified — will not appear publicly)</span>}</span>
                      <button className="text-xs font-semibold text-muted" onClick={() => setSelectedProvider(null)} type="button">Change</button>
                    </div>
                  ) : (
                    <>
                      <input className="rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setProviderQuery(event.target.value)} placeholder="Search providers by name…" value={providerQuery} />
                      {providerOptions.length > 0 && (
                        <div className="grid gap-1">
                          {providerOptions.map((option) => (
                            <button className="flex items-center justify-between rounded-xl border border-hairline p-2 text-left text-sm hover:border-brand" key={option.id} onClick={() => { setSelectedProvider(option); setProviderOptions([]); }} type="button">
                              <span>{option.displayName}</span>
                              <span className={option.verificationStatus === "VERIFIED" ? "text-xs font-semibold text-teal" : "text-xs text-muted"}>{option.verificationStatus}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <p className="text-[11px] text-muted">Only VERIFIED providers are ever shown publicly — this is enforced automatically regardless of what is selected here.</p>
                </div>
              )}

              <div className="mt-2 border-t border-hairline pt-4 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">2. Promoted content</p>
                <p className="mt-1 text-xs leading-5 text-muted">Write the customer-facing message and decide where the call to action leads. When artwork is uploaded it is shown on its own, exactly as designed; the headline is then used for screen readers and as the text version if no artwork is available.</p>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-ink sm:col-span-2">
                Headline
                <input className="rounded-xl border border-hairline p-2.5 text-sm font-normal" onChange={(event) => setDraft({ ...draft, headline: event.target.value })} placeholder="Exceptional properties. Greater possibilities." required value={draft.headline} />
              </label>
              <input className="rounded-xl border border-hairline p-2 text-sm sm:col-span-2" onChange={(event) => setDraft({ ...draft, supportingText: event.target.value })} placeholder="Supporting text (optional)" value={draft.supportingText} />
              <div>
                <input className="w-full rounded-xl border border-hairline p-2 text-sm" list="campaign-cta-presets" onChange={(event) => setDraft({ ...draft, ctaLabel: event.target.value })} placeholder="CTA label — e.g. Explore Properties" value={draft.ctaLabel} />
                <datalist id="campaign-cta-presets">
                  {CTA_PRESETS.map((label) => <option key={label} value={label} />)}
                </datalist>
              </div>
              <input className="rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })} placeholder="https://…" required type="url" value={draft.destinationUrl} />
              {!editingId && <>
                <div className="mt-2 border-t border-hairline pt-4 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">3. Scheduling & delivery</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Publish immediately or choose a future campaign window. Higher priority campaigns are preferred when multiple campaigns qualify for the same placement.</p>
                </div>
                <label className="grid gap-1.5 text-xs font-semibold text-ink">
                  Priority
                  <input className="rounded-xl border border-hairline p-2.5 text-sm font-normal" min={0} max={1000} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} placeholder="0" type="number" value={draft.priority} />
                </label>
                <div />
                <label className="text-xs text-muted">Start (optional)<input className="mt-1 block w-full rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setDraft({ ...draft, startAt: event.target.value })} type="datetime-local" value={draft.startAt} /></label>
                <label className="text-xs text-muted">End (optional)<input className="mt-1 block w-full rounded-xl border border-hairline p-2 text-sm" onChange={(event) => setDraft({ ...draft, endAt: event.target.value })} type="datetime-local" value={draft.endAt} /></label>
              </>}
              {editingId ? (
                <button className="rounded bg-forest px-4 py-2 text-sm font-semibold text-white sm:col-span-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-muted" disabled={saving} type="submit">
                  {saving ? "Saving…" : "Save changes"}
                </button>
              ) : (
                <div className="flex gap-2 sm:col-span-2">
                  <button className="flex-1 rounded-xl border border-hairline border-hairline px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:border-hairline disabled:text-muted" disabled={saving} name="intent" type="submit" value="draft">
                    {saving ? "Saving…" : "Save Draft"}
                  </button>
                  <button className="flex-1 rounded bg-forest px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-muted" disabled={saving} name="intent" type="submit" value="publish">
                    {saving ? "Saving…" : draft.startAt ? "Schedule Campaign" : "Publish Now"}
                  </button>
                </div>
              )}
            </form>

            <div className="grid content-start gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">Production preview</p>
                    <p className="mt-0.5 text-xs text-muted">{PLACEMENT_LABELS[draft.placement]}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${draftDevice === "desktop" ? "border-forest bg-forest text-white" : "border-hairline text-muted"}`} onClick={() => setDraftDevice("desktop")} type="button">Desktop</button>
                    <button className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${draftDevice === "mobile" ? "border-forest bg-forest text-white" : "border-hairline text-muted"}`} onClick={() => setDraftDevice("mobile")} type="button">Mobile</button>
                    <button className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${draftDevice === "nativeApp" ? "border-forest bg-forest text-white" : "border-hairline text-muted"}`} onClick={() => setDraftDevice("nativeApp")} type="button">Native App</button>
                  </div>
                </div>
                <div className="mt-2">
                  <CampaignPreview
                    ctaLabel={draft.ctaLabel}
                    desktopMediaUrl={stagedDesktopPreview ?? editingCampaign?.desktopMediaUrl ?? null}
                    device={draftDevice}
                    headline={draft.headline}
                    mobileMediaUrl={stagedMobilePreview ?? editingCampaign?.mobileMediaUrl ?? null}
                    nativeAppMediaUrl={stagedNativeAppPreview ?? editingCampaign?.nativeAppMediaUrl ?? null}
                    placement={draft.placement}
                    supportingText={draft.supportingText}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted">Preview uses the production placement proportions and current campaign content.</p>
              </div>

              <div className="rounded-xl border border-hairline bg-warm-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Publishing summary</p>
                <dl className="mt-3 grid gap-2 text-xs">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Placement</dt>
                    <dd className="text-right font-semibold text-forest">{PLACEMENT_LABELS[draft.placement]}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Starts</dt>
                    <dd className="text-right font-semibold text-forest">{draft.startAt ? "Scheduled date & time" : "Immediately when published"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Ends</dt>
                    <dd className="text-right font-semibold text-forest">{draft.endAt ? "Scheduled date & time" : "No automatic end date"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Creative</dt>
                    <dd className="text-right font-semibold text-forest">{draftSpec ? "Responsive desktop / mobile" : "Text announcement"}</dd>
                  </div>
                </dl>
              </div>

              {draftSpec && (
                <div className="rounded-lg border border-dashed p-3">
                  <p className="text-xs font-semibold text-ink">Creative specification</p>
                  <p className="mt-1 text-xs text-muted">Desktop: <span className="font-semibold text-forest">{draftSpec.desktop.width} × {draftSpec.desktop.height}px</span> ({ratioLabel(draftSpec.desktop)})</p>
                  <p className="text-xs text-muted">Mobile web: <span className="font-semibold text-forest">{draftSpec.mobile.width} × {draftSpec.mobile.height}px</span> ({ratioLabel(draftSpec.mobile)})</p>
                  <p className="text-xs text-muted">Native app: <span className="font-semibold text-forest">{draftSpec.nativeApp.width} × {draftSpec.nativeApp.height}px</span> ({ratioLabel(draftSpec.nativeApp)})</p>
                  {!draftSpec.measured && <p className="mt-1 text-[11px] text-ink">This placement has no live public page yet — this spec is a provisional default.</p>}
                </div>
              )}

              {draftSpec ? (
              <div className="grid gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">4. Promotional creative</p>
                  <p className="mt-1 text-xs text-muted">Upload placement-specific artwork for desktop web, mobile web and the native mobile app. Mobile web falls back to desktop; native app falls back to mobile web and then desktop.</p>
                </div>
                {editingId ? (
                  <>
                    <ImageSlot
                      label="Desktop carousel image"
                      onRemove={() => void removeCreative(editingId, "desktop")}
                      onSelect={(file) => void uploadCreative(editingId, "desktop", file)}
                      previewUrl={editingCampaign?.desktopMediaUrl ?? null}
                      spec={draftSpec?.desktop ?? { width: 1600, height: 220 }}
                    />
                    <ImageSlot
                      label="Mobile carousel image (optional — falls back to desktop image)"
                      onRemove={() => void removeCreative(editingId, "mobile")}
                      onSelect={(file) => void uploadCreative(editingId, "mobile", file)}
                      previewUrl={editingCampaign?.mobileMediaUrl ?? null}
                      spec={draftSpec?.mobile ?? { width: 800, height: 320 }}
                    />
                    <ImageSlot
                      label="Native app carousel image (optional — falls back to mobile web, then desktop)"
                      onRemove={() => void removeCreative(editingId, "nativeApp")}
                      onSelect={(file) => void uploadCreative(editingId, "nativeApp", file)}
                      previewUrl={editingCampaign?.nativeAppMediaUrl ?? null}
                      spec={draftSpec?.nativeApp ?? { width: 1200, height: 792 }}
                    />
                  </>
                ) : (
                  <>
                    <ImageSlot
                      label="Desktop carousel image"
                      onRemove={() => clearStaged("desktop")}
                      onSelect={(file) => stageFile("desktop", file)}
                      previewUrl={stagedDesktopPreview}
                      spec={draftSpec?.desktop ?? { width: 1600, height: 220 }}
                    />
                    <ImageSlot
                      label="Mobile carousel image (optional — falls back to desktop image)"
                      onRemove={() => clearStaged("mobile")}
                      onSelect={(file) => stageFile("mobile", file)}
                      previewUrl={stagedMobilePreview}
                      spec={draftSpec?.mobile ?? { width: 800, height: 320 }}
                    />
                    <ImageSlot
                      label="Native app carousel image (optional — falls back to mobile web, then desktop)"
                      onRemove={() => clearStaged("nativeApp")}
                      onSelect={(file) => stageFile("nativeApp", file)}
                      previewUrl={stagedNativeAppPreview}
                      spec={draftSpec?.nativeApp ?? { width: 1200, height: 792 }}
                    />
                  </>
                )}
              </div>
              ) : (
                <div className="rounded-xl border border-hairline bg-warm-white p-4">
                  <p className="text-xs font-semibold text-forest">Homepage Announcement</p>
                  <p className="mt-1 text-xs leading-5 text-muted">No image is required for this placement. The public homepage renders the headline, supporting text and optional call to action as a compact NesAfric announcement bar.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * A single desktop/mobile/native-app creative slot — used identically whether the campaign already exists
 * (`onSelect` uploads over the network immediately) or doesn't yet (`onSelect` just stages the
 * file client-side; see `stageFile` above) — the component itself has no opinion on which, so the
 * create and edit workflows share one implementation and one visual result.
 */
function ImageSlot({
  label, spec, previewUrl, onSelect, onRemove,
}: { label: string; spec: { width: number; height: number }; previewUrl: string | null; onSelect: (file: File) => void; onRemove: () => void }) {
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
            `Actual image: ${image.width} × ${image.height}px. Recommended: ${spec.width} × ${spec.height}px (${ratioLabel(spec)}). Upload another image for a pixel-perfect fit, or continue — it will be cropped to fit rather than stretched.`,
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
    onSelect(file);
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-semibold text-ink">{label}</p>
      <p className="text-[11px] text-muted">Recommended: {spec.width} × {spec.height}px · Aspect ratio {ratioLabel(spec)}</p>
      {previewUrl && (
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="h-14 w-24 rounded object-cover" src={previewUrl} />
          <div className="flex flex-col gap-1 text-[11px] font-semibold">
            <button className="text-left text-ink" onClick={() => inputRef.current?.click()} type="button">Replace</button>
            <button className="text-left text-red-600" onClick={onRemove} type="button">Remove</button>
          </div>
        </div>
      )}
      <div
        className={`mt-2 grid place-items-center rounded-lg border-2 border-dashed p-4 text-center text-xs ${dragOver ? "border-brand bg-gold/5" : "border-hairline"}`}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        <p className="text-muted">Drag & drop image here</p>
        <p className="my-1 text-muted">or</p>
        <button className="rounded-lg border px-3 py-1.5 font-semibold text-ink" onClick={() => inputRef.current?.click()} type="button">
          Upload {label.toLowerCase().includes("mobile") ? "mobile" : "desktop"} image
        </button>
        <p className="mt-2 text-muted">PNG • JPG • WEBP · Maximum 25MB</p>
        <input
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }}
          ref={inputRef}
          type="file"
        />
      </div>
      {warning && <p className="mt-2 rounded-lg bg-gold/10 p-2 text-[11px] text-ink">{warning}</p>}
    </div>
  );
}
