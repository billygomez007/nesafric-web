"use client";

import { useEffect, useState } from "react";

type EvidenceItem = {
  id: string; type: string; reviewStatus: string; rejectionReason: string | null;
  storageObjectId: string | null; createdAt: string; supersededByEvidenceId: string | null;
};
type Consent = { version: string; accurate: boolean; authorized: boolean; reviewConsented: boolean; termsAccepted: boolean; acceptedAt: string };
type HistoryEntry = { id: string; fromStatus: string; toStatus: string; reason: string | null; createdAt: string; metadata: { authority?: string } | null };
type ProviderDetail = {
  id: string; displayName: string; type: string; verificationStatus: string; updatedAt: string;
  evidence: EvidenceItem[]; verificationConsents: Consent[];
  suspendedAt: string | null; suspensionReason: string | null;
  identityVerifiedAt: string | null; businessVerifiedAt: string | null; skillVerifiedAt: string | null;
  verificationHistory: HistoryEntry[];
  categories: { category: { name: string } }[];
  serviceAreas: { areaType: string; name: string }[];
};
type ProviderRow = {
  id: string; displayName: string; type: string; verificationStatus: string; suspendedAt: string | null;
  createdAt: string; categories: string[]; serviceAreas: string[]; evidenceCount: number;
  identityVerifiedAt: string | null; businessVerifiedAt: string | null;
};

const QUEUE_TABS = [
  { value: "PENDING_VERIFICATION", label: "Pending verification" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REQUIRES_MORE_INFO", label: "Requires more info" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "ALL", label: "All" },
] as const;

function ProvidersQueue() {
  const [tab, setTab] = useState<(typeof QUEUE_TABS)[number]["value"]>("PENDING_VERIFICATION");
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadList(nextTab = tab) {
    const response = await fetch(`/api/platform-admin/service-providers?tab=${nextTab}`);
    const body = await response.json();
    if (response.ok) setRows(body);
    else { setError(body.error?.message ?? "Unable to load providers."); setRows([]); }
  }

  async function loadDetail(providerId: string) {
    setSelectedId(providerId);
    const response = await fetch(`/api/platform-admin/service-providers/${providerId}`);
    const body = await response.json();
    if (response.ok) setDetail(body);
    else setError(body.error?.message ?? "Unable to load this provider.");
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tab-change data fetch; loadList is also reused after mutations below, so it can't be restructured to avoid this.
    setRows(null);
    void loadList(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadList intentionally excluded: it reads the latest `tab` via its own default parameter, re-declaring it every render would defeat this effect's tab-change trigger.
  }, [tab]);

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

  async function suspend() {
    if (!selectedId) return;
    setError(""); setNotice("");
    const reason = window.prompt("Reason for suspending this provider platform-wide? (Visible in audit history.)");
    if (!reason) return;
    const response = await fetch(`/api/providers/${selectedId}/verification/suspend`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to suspend this provider.");
    setNotice("Provider suspended platform-wide — removed from public discovery and dispatch everywhere.");
    await Promise.all([loadDetail(selectedId), loadList()]);
  }

  async function reinstate() {
    if (!selectedId) return;
    setError(""); setNotice("");
    const response = await fetch(`/api/providers/${selectedId}/verification/reinstate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to reinstate this provider.");
    setNotice("Provider reinstated. They must still re-enable their own availability before receiving new work.");
    await Promise.all([loadDetail(selectedId), loadList()]);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {QUEUE_TABS.map((t) => (
          <button
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${tab === t.value ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600"}`}
            key={t.value}
            onClick={() => setTab(t.value)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          {rows === null ? <p className="text-sm text-slate-500">Loading…</p> : (
            <div className="grid gap-2">
              {rows.length === 0 && <p className="text-sm text-slate-500">Nothing in this view.</p>}
              {rows.map((provider) => (
                <button
                  className={`rounded-lg border p-3 text-left text-sm ${selectedId === provider.id ? "border-emerald-600 bg-emerald-50" : ""}`}
                  key={provider.id}
                  onClick={() => loadDetail(provider.id)}
                  type="button"
                >
                  <p className="font-semibold">{provider.displayName} {provider.suspendedAt && <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">SUSPENDED</span>}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{provider.type} · {provider.verificationStatus} · {provider.evidenceCount} document{provider.evidenceCount === 1 ? "" : "s"} · {provider.categories.join(", ") || "no categories"}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {!detail ? <p className="text-sm text-slate-500">Select a provider to review.</p> : (
            <div className="grid gap-5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold">{detail.displayName}</h2>
                  {detail.suspendedAt ? (
                    <button className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => void reinstate()} type="button">Reinstate</button>
                  ) : (
                    <button className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => void suspend()} type="button">Suspend</button>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">{detail.type} · Status: {detail.verificationStatus}</p>
                {detail.suspendedAt && <p className="mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-800">Suspended platform-wide {new Date(detail.suspendedAt).toLocaleString()}{detail.suspensionReason ? `: ${detail.suspensionReason}` : ""}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${detail.identityVerifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Identity {detail.identityVerifiedAt ? "verified" : "pending"}</span>
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${detail.businessVerifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Business {detail.businessVerifiedAt ? "verified" : "not verified"}</span>
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${detail.skillVerifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Skill/credential {detail.skillVerifiedAt ? "verified" : "not verified"}</span>
                </div>
              </div>

              <div>
                <h3 className="font-semibold">Services &amp; areas</h3>
                <p className="mt-1 text-sm text-slate-600">{detail.categories.map((c) => c.category.name).join(", ") || "No categories selected"}</p>
                <p className="text-sm text-slate-600">{detail.serviceAreas.map((a) => `${a.areaType}: ${a.name}`).join(", ") || "No service areas defined"}</p>
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
    </div>
  );
}

type CategoryRow = {
  id: string; key: string; name: string; description: string | null; group: string; sortOrder: number;
  active: boolean; publiclyVisible: boolean; onboardingSelectable: boolean;
};
const GROUP_LABELS: Record<string, string> = {
  REPAIRS_MAINTENANCE: "Repairs & maintenance", BUILDING_CONSTRUCTION: "Building & construction",
  PROPERTY_CARE: "Property care", SECURITY_SYSTEMS: "Security & systems",
  DESIGN_PROPERTY_SERVICES: "Design & property services", OTHER: "Other",
};

function CategoriesAdmin() {
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({ key: "", name: "", group: "OTHER", description: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/platform-admin/service-categories");
    const body = await response.json();
    if (response.ok) setCategories(body);
    else { setError(body.error?.message ?? "Unable to load categories."); setCategories([]); }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount; load is also reused after mutations below.
    void load();
  }, []);

  async function toggle(category: CategoryRow, field: "active" | "publiclyVisible" | "onboardingSelectable") {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/service-categories/${category.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: !category[field] }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update this category.");
    await load();
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setNotice(""); setSaving(true);
    try {
      const response = await fetch("/api/platform-admin/service-categories", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: draft.key, name: draft.name, group: draft.group, description: draft.description || undefined }),
      });
      const body = await response.json();
      if (!response.ok) return setError(body.error?.message ?? "Unable to create that category.");
      setNotice(`Category "${body.name}" created.`);
      setDraft({ key: "", name: "", group: "OTHER", description: "" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (categories === null) return <p className="text-sm text-slate-500">Loading categories…</p>;

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <form className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-5" onSubmit={create}>
        <input className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="key (e.g. drone_photography)" required value={draft.key} />
        <input className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Display name" required value={draft.name} />
        <select className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, group: e.target.value })} value={draft.group}>
          {Object.entries(GROUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input className="rounded border p-2 text-sm sm:col-span-2" onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description (optional)" value={draft.description} />
        <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 sm:col-span-5 sm:w-fit" disabled={saving} type="submit">{saving ? "Saving…" : "Add category"}</button>
      </form>

      <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Public</th>
              <th className="px-4 py-3">Onboarding</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.map((category) => (
              <tr key={category.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-950">{category.name}</p>
                  <p className="text-xs text-slate-500">{category.key}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">{GROUP_LABELS[category.group] ?? category.group}</td>
                <td className="px-4 py-3">
                  <button className={`rounded-full px-2.5 py-1 text-xs font-semibold ${category.active ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`} onClick={() => void toggle(category, "active")} type="button">{category.active ? "Active" : "Deactivated"}</button>
                </td>
                <td className="px-4 py-3">
                  <button className={`rounded-full px-2.5 py-1 text-xs font-semibold ${category.publiclyVisible ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`} onClick={() => void toggle(category, "publiclyVisible")} type="button">{category.publiclyVisible ? "Public" : "Hidden"}</button>
                </td>
                <td className="px-4 py-3">
                  <button className={`rounded-full px-2.5 py-1 text-xs font-semibold ${category.onboardingSelectable ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`} onClick={() => void toggle(category, "onboardingSelectable")} type="button">{category.onboardingSelectable ? "Selectable" : "Hidden"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

type RequirementRow = {
  id: string; countryCode: string | null; providerType: string | null; evidenceType: string; requirementLevel: string;
  conditionNote: string | null; label: string; active: boolean; category: { name: string } | null;
};
const EVIDENCE_TYPES = ["IDENTITY", "GHANA_CARD_FRONT", "GHANA_CARD_BACK", "BUSINESS_REGISTRATION", "PROFESSIONAL_LICENSE", "TRADE_CERTIFICATE", "SAFETY_CERTIFICATION", "INSURANCE", "ADDRESS", "PORTFOLIO_EVIDENCE", "REFERENCE_EVIDENCE", "TRAINING_CERTIFICATE", "OTHER"];

function DocumentRequirementsAdmin() {
  const [requirements, setRequirements] = useState<RequirementRow[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ countryCode: "GH", categoryId: "", providerType: "", evidenceType: "PROFESSIONAL_LICENSE", requirementLevel: "CONDITIONAL", label: "", conditionNote: "" });

  async function load() {
    const [reqResponse, catResponse] = await Promise.all([
      fetch("/api/platform-admin/document-requirements"),
      fetch("/api/platform-admin/service-categories"),
    ]);
    const reqBody = await reqResponse.json();
    if (reqResponse.ok) setRequirements(reqBody); else { setError(reqBody.error?.message ?? "Unable to load document requirements."); setRequirements([]); }
    if (catResponse.ok) setCategories(await catResponse.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount; load is also reused after mutations below.
    void load();
  }, []);

  async function toggleActive(requirement: RequirementRow) {
    setError(""); setNotice("");
    const response = await fetch(`/api/platform-admin/document-requirements/${requirement.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !requirement.active }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update this requirement.");
    await load();
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setNotice(""); setSaving(true);
    try {
      const response = await fetch("/api/platform-admin/document-requirements", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          countryCode: draft.countryCode || undefined,
          categoryId: draft.categoryId || undefined,
          providerType: draft.providerType || undefined,
          evidenceType: draft.evidenceType,
          requirementLevel: draft.requirementLevel,
          conditionNote: draft.requirementLevel === "CONDITIONAL" ? draft.conditionNote : undefined,
          label: draft.label,
        }),
      });
      const body = await response.json();
      if (!response.ok) return setError(body.error?.message ?? "Unable to create that requirement.");
      setNotice(`Requirement "${body.label}" created.`);
      setDraft({ ...draft, categoryId: "", label: "", conditionNote: "" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (requirements === null) return <p className="text-sm text-slate-500">Loading document requirements…</p>;

  return (
    <div className="grid gap-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <form className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-3" onSubmit={create}>
        <input className="rounded border p-2 text-sm" maxLength={2} onChange={(e) => setDraft({ ...draft, countryCode: e.target.value.toUpperCase() })} placeholder="Country (blank = all)" value={draft.countryCode} />
        <select className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })} value={draft.categoryId}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, providerType: e.target.value })} value={draft.providerType}>
          <option value="">Individual + company</option>
          <option value="INDIVIDUAL">Individual only</option>
          <option value="COMPANY">Company only</option>
        </select>
        <select className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, evidenceType: e.target.value })} value={draft.evidenceType}>
          {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
        </select>
        <select className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, requirementLevel: e.target.value })} value={draft.requirementLevel}>
          <option value="REQUIRED">Required</option>
          <option value="CONDITIONAL">Conditional</option>
          <option value="OPTIONAL">Optional</option>
        </select>
        <input className="rounded border p-2 text-sm" onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label shown to provider" required value={draft.label} />
        {draft.requirementLevel === "CONDITIONAL" && (
          <input className="rounded border p-2 text-sm sm:col-span-3" onChange={(e) => setDraft({ ...draft, conditionNote: e.target.value })} placeholder="Condition, e.g. 'Required only where local licensing applies.'" required value={draft.conditionNote} />
        )}
        <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 sm:col-span-3 sm:w-fit" disabled={saving} type="submit">{saving ? "Saving…" : "Add requirement"}</button>
      </form>

      <section className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {requirements.map((requirement) => (
              <tr key={requirement.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-950">{requirement.label}</p>
                  <p className="text-xs text-slate-500">{requirement.evidenceType.replaceAll("_", " ")}{requirement.conditionNote ? ` — ${requirement.conditionNote}` : ""}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">{requirement.countryCode ?? "All countries"} · {requirement.providerType ?? "Individual + company"} · {requirement.category?.name ?? "All categories"}</td>
                <td className="px-4 py-3 text-slate-600">{requirement.requirementLevel}</td>
                <td className="px-4 py-3">
                  <button className={`rounded-full px-2.5 py-1 text-xs font-semibold ${requirement.active ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`} onClick={() => void toggleActive(requirement)} type="button">{requirement.active ? "Active" : "Deactivated"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const VIEWS = [
  { value: "providers", label: "Providers" },
  { value: "categories", label: "Categories" },
  { value: "requirements", label: "Document requirements" },
] as const;

export function ServiceProvidersAdminContent() {
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("providers");
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {VIEWS.map((v) => (
          <button
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${view === v.value ? "border-navy bg-navy text-white" : "border-slate-200 text-slate-600"}`}
            key={v.value}
            onClick={() => setView(v.value)}
            type="button"
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "providers" && <ProvidersQueue />}
      {view === "categories" && <CategoriesAdmin />}
      {view === "requirements" && <DocumentRequirementsAdmin />}
    </div>
  );
}
