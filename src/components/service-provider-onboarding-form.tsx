"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";

type Category = { id: string; key: string; name: string };
type Organisation = { id: string; name: string };
type DocumentRequirement = { evidenceType: string; label: string; description: string | null; required: boolean };
type ServiceArea = { countryCode: string; region: string; city: string };

const STEP_LABELS = [
  "Account type", "Business information", "Services", "Service areas",
  "Identity verification", "Business documents", "Portfolio", "Review & consent", "Submit",
];

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function uploadEvidence(providerId: string, evidenceType: string, file: File) {
  const response = await fetch(`/api/providers/${providerId}/verification/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      dataBase64: await fileToBase64(file),
      evidenceType,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Unable to upload ${evidenceType}.`);
  // Only forward type/reference — the raw evidence row also carries `expiresAt: null`, which
  // `z.coerce.date()` on the verification-submit schema turns into the Unix epoch (a very
  // definitely-expired date) rather than leaving it absent.
  return { type: body.attached.type as string, reference: body.attached.reference as string };
}

export function ServiceProviderOnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [accountType, setAccountType] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [companyOrganisationId, setCompanyOrganisationId] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [biography, setBiography] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([{ countryCode: "GH", region: "", city: "" }]);

  const [providerId, setProviderId] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([]);
  const [identityFiles, setIdentityFiles] = useState<Record<string, File | null>>({});
  const [businessFiles, setBusinessFiles] = useState<Record<string, File | null>>({});
  const [portfolioFile, setPortfolioFile] = useState<File | null>(null);
  const [submittedEvidence, setSubmittedEvidence] = useState<{ type: string; reference: string }[]>([]);

  const [consent, setConsent] = useState({ accurate: false, authorized: false, reviewConsented: false, termsAccepted: false });

  useEffect(() => {
    fetch("/api/providers/categories").then(async (response) => {
      if (response.ok) setCategories(await response.json());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (accountType !== "COMPANY") return;
    fetch("/api/organisations").then(async (response) => {
      if (response.ok) setOrganisations(await response.json());
    }).catch(() => {});
  }, [accountType]);

  const identityRequirements = requirements.filter((requirement) => requirement.evidenceType.startsWith("GHANA_CARD"));
  const businessRequirements = requirements.filter((requirement) => !requirement.evidenceType.startsWith("GHANA_CARD"));

  function updateServiceArea(index: number, patch: Partial<ServiceArea>) {
    setServiceAreas((current) => current.map((area, position) => (position === index ? { ...area, ...patch } : area)));
  }

  async function createProviderAndFetchRequirements() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: accountType,
          companyOrganisationId: accountType === "COMPANY" ? companyOrganisationId : undefined,
          displayName,
          legalName: legalName || undefined,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          biography: biography || undefined,
          categoryIds,
          serviceAreas: serviceAreas.filter((area) => area.city || area.region).map((area) => ({
            areaType: "SERVICE_AREA",
            name: [area.city, area.region, area.countryCode].filter(Boolean).join(", "),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to create your service-provider profile.");
      setProviderId(body.id);

      await fetch("/api/marketplace/providers/" + body.id + "/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryIds,
          serviceAreas: serviceAreas.filter((area) => area.city || area.region).map((area) => ({
            countryCode: area.countryCode, region: area.region || undefined, city: area.city || undefined,
          })),
        }),
      }).catch(() => {});

      const requirementParams = new URLSearchParams({ countryCode: "GH", providerType: accountType });
      for (const categoryId of categoryIds) requirementParams.append("categoryId", categoryId);
      const requirementResponse = await fetch(`/api/public/providers/document-requirements?${requirementParams}`);
      if (requirementResponse.ok) setRequirements(await requirementResponse.json());

      trackCampaignEvent("service_provider_registration_started");
      setStep(5);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create your service-provider profile.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitIdentityDocuments() {
    if (!providerId) return;
    const missing = identityRequirements.filter((requirement) => requirement.required && !identityFiles[requirement.evidenceType]);
    if (missing.length) return setError(`Please upload: ${missing.map((requirement) => requirement.label).join(", ")}.`);
    setError("");
    setSubmitting(true);
    try {
      const uploaded: { type: string; reference: string }[] = [];
      for (const requirement of identityRequirements) {
        const file = identityFiles[requirement.evidenceType];
        if (!file) continue;
        uploaded.push(await uploadEvidence(providerId, requirement.evidenceType, file));
      }
      setSubmittedEvidence((current) => [...current, ...uploaded]);
      setStep(6);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload identity documents.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBusinessDocuments() {
    if (!providerId) return;
    const missing = businessRequirements.filter((requirement) => requirement.required && !businessFiles[requirement.evidenceType]);
    if (missing.length) return setError(`Please upload: ${missing.map((requirement) => requirement.label).join(", ")}.`);
    setError("");
    setSubmitting(true);
    try {
      const uploaded: { type: string; reference: string }[] = [];
      for (const requirement of businessRequirements) {
        const file = businessFiles[requirement.evidenceType];
        if (!file) continue;
        uploaded.push(await uploadEvidence(providerId, requirement.evidenceType, file));
      }
      setSubmittedEvidence((current) => [...current, ...uploaded]);
      setStep(7);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload business documents.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPortfolio() {
    if (!providerId) return setStep(8);
    setError("");
    setSubmitting(true);
    try {
      if (portfolioFile) await uploadEvidence(providerId, "PORTFOLIO_EVIDENCE", portfolioFile);
      setStep(8);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload portfolio evidence.");
    } finally {
      setSubmitting(false);
    }
  }

  async function finalSubmit() {
    if (!providerId) return;
    if (!consent.accurate || !consent.authorized || !consent.reviewConsented || !consent.termsAccepted) {
      return setError("All four consent statements must be confirmed before submitting for review.");
    }
    setError("");
    setSubmitting(true);
    try {
      const consentResponse = await fetch(`/api/providers/${providerId}/verification/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "2026-08-28", ...consent }),
      });
      if (!consentResponse.ok) throw new Error((await consentResponse.json()).error?.message ?? "Unable to record consent.");

      const verificationResponse = await fetch(`/api/providers/${providerId}/verification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: submittedEvidence }),
      });
      if (!verificationResponse.ok) throw new Error((await verificationResponse.json()).error?.message ?? "Unable to submit for verification.");

      trackCampaignEvent("service_provider_registration_completed");
      router.push(`/providers/${providerId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit your verification.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8 grid gap-6">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
        {STEP_LABELS.map((label, index) => (
          <span className={`rounded-full px-3 py-1 ${index + 1 === step ? "bg-brand text-navy" : index + 1 < step ? "bg-slate-200" : "bg-slate-100"}`} key={label}>
            {index + 1}. {label}
          </span>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {step === 1 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Are you registering as an individual or a company?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className={`rounded-xl border p-4 text-left ${accountType === "INDIVIDUAL" ? "border-brand bg-brand/5" : ""}`} onClick={() => setAccountType("INDIVIDUAL")} type="button">
              <p className="font-semibold">Individual / artisan</p>
              <p className="mt-1 text-sm text-slate-600">You work independently — plumber, electrician, agent, etc.</p>
            </button>
            <button className={`rounded-xl border p-4 text-left ${accountType === "COMPANY" ? "border-brand bg-brand/5" : ""}`} onClick={() => setAccountType("COMPANY")} type="button">
              <p className="font-semibold">Company / business</p>
              <p className="mt-1 text-sm text-slate-600">A registered business with a team — contractor, facilities company, etc.</p>
            </button>
          </div>
          {accountType === "COMPANY" && (
            <label className="text-sm font-medium">
              Which organisation is this business?
              <select className="mt-1 w-full rounded border p-3" onChange={(event) => setCompanyOrganisationId(event.target.value)} value={companyOrganisationId}>
                <option value="">Select an organisation</option>
                {organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
              </select>
              {organisations.length === 0 && <span className="mt-1 block text-xs text-slate-500">No organisations found — create one first, then return to this page.</span>}
            </label>
          )}
          <button className="rounded bg-brand p-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={accountType === "COMPANY" && !companyOrganisationId} onClick={() => setStep(2)} type="button">
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <label className="text-sm font-medium">Business / display name<input className="mt-1 w-full rounded border p-3" onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Kofi Mensah Electrical" required value={displayName} /></label>
          <label className="text-sm font-medium">Legal name <span className="font-normal text-slate-500">(optional)</span><input className="mt-1 w-full rounded border p-3" onChange={(event) => setLegalName(event.target.value)} value={legalName} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Contact email<input className="mt-1 w-full rounded border p-3" onChange={(event) => setContactEmail(event.target.value)} type="email" value={contactEmail} /></label>
            <label className="text-sm font-medium">Contact phone<input className="mt-1 w-full rounded border p-3" onChange={(event) => setContactPhone(event.target.value)} value={contactPhone} /></label>
          </div>
          <label className="text-sm font-medium">Description <span className="font-normal text-slate-500">(optional)</span><textarea className="mt-1 w-full rounded border p-3" onChange={(event) => setBiography(event.target.value)} rows={4} value={biography} /></label>
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(1)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={!displayName || (!contactEmail && !contactPhone)} onClick={() => setStep(3)} type="button">Continue</button></div>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Which services do you offer?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((category) => (
              <label className="flex items-center gap-2 rounded-lg border p-3 text-sm" key={category.id}>
                <input
                  checked={categoryIds.includes(category.id)}
                  onChange={(event) => setCategoryIds((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id))}
                  type="checkbox"
                />
                {category.name}
              </label>
            ))}
          </div>
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(2)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={!categoryIds.length} onClick={() => setStep(4)} type="button">Continue</button></div>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Where do you offer these services?</p>
          {serviceAreas.map((area, index) => (
            <div className="grid gap-3 sm:grid-cols-3" key={index}>
              <input className="rounded border bg-slate-50 p-3 uppercase" readOnly value={area.countryCode} />
              <input className="rounded border p-3" onChange={(event) => updateServiceArea(index, { region: event.target.value })} placeholder="Region" value={area.region} />
              <input className="rounded border p-3" onChange={(event) => updateServiceArea(index, { city: event.target.value })} placeholder="City" value={area.city} />
            </div>
          ))}
          <button className="text-left text-sm font-semibold text-navy" onClick={() => setServiceAreas((current) => [...current, { countryCode: "GH", region: "", city: "" }])} type="button">+ Add another area</button>
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(3)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting || !serviceAreas.some((area) => area.city || area.region)} onClick={createProviderAndFetchRequirements} type="button">{submitting ? "Creating profile…" : "Create profile & continue"}</button></div>
        </div>
      )}

      {step === 5 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Mandatory identity verification</p>
          <p className="text-sm text-slate-600">UmoAfric requires a Ghana Card to keep the marketplace safe and trustworthy. This is private and reviewed only by authorised UmoAfric staff — it is never shown publicly.</p>
          {identityRequirements.map((requirement) => (
            <label className="text-sm font-medium" key={requirement.evidenceType}>
              {requirement.label}{requirement.required && <span className="text-red-600"> *</span>}
              <input accept="image/*" capture="environment" className="mt-1 w-full rounded border p-3" onChange={(event) => setIdentityFiles((current) => ({ ...current, [requirement.evidenceType]: event.target.files?.[0] ?? null }))} type="file" />
            </label>
          ))}
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(4)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting} onClick={submitIdentityDocuments} type="button">{submitting ? "Uploading…" : "Continue"}</button></div>
        </div>
      )}

      {step === 6 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Business & credential documents</p>
          {businessRequirements.length === 0 ? (
            <p className="text-sm text-slate-600">No additional documents are required for your account type and services.</p>
          ) : businessRequirements.map((requirement) => (
            <label className="text-sm font-medium" key={requirement.evidenceType}>
              {requirement.label}{requirement.required && <span className="text-red-600"> *</span>}
              <input accept="image/*,application/pdf" className="mt-1 w-full rounded border p-3" onChange={(event) => setBusinessFiles((current) => ({ ...current, [requirement.evidenceType]: event.target.files?.[0] ?? null }))} type="file" />
            </label>
          ))}
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(5)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting} onClick={submitBusinessDocuments} type="button">{submitting ? "Uploading…" : "Continue"}</button></div>
        </div>
      )}

      {step === 7 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Portfolio <span className="font-normal text-slate-500">(optional)</span></p>
          <p className="text-sm text-slate-600">Show examples of your past work. You can add more later from your dashboard.</p>
          <input accept="image/*" className="rounded border p-3" onChange={(event) => setPortfolioFile(event.target.files?.[0] ?? null)} type="file" />
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(6)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting} onClick={submitPortfolio} type="button">{submitting ? "Saving…" : "Continue"}</button></div>
        </div>
      )}

      {step === 8 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Review & consent</p>
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            <p><strong>{displayName}</strong> · {accountType === "INDIVIDUAL" ? "Individual" : "Company"}</p>
            <p className="mt-1">{categoryIds.length} service{categoryIds.length === 1 ? "" : "s"} · {serviceAreas.filter((area) => area.city || area.region).length} service area{serviceAreas.length === 1 ? "" : "s"}</p>
            <p className="mt-1">{submittedEvidence.length} document{submittedEvidence.length === 1 ? "" : "s"} uploaded</p>
          </div>
          {[
            ["accurate", "I confirm the information I have provided is accurate."],
            ["authorized", "I confirm the uploaded documents belong to me, or to a person I am authorised to represent."],
            ["reviewConsented", "I consent to UmoAfric reviewing my verification evidence."],
            ["termsAccepted", "I agree to the UmoAfric service-provider terms and privacy requirements."],
          ].map(([key, label]) => (
            <label className="flex items-start gap-2 text-sm" key={key}>
              <input checked={consent[key as keyof typeof consent]} className="mt-1" onChange={(event) => setConsent((current) => ({ ...current, [key]: event.target.checked }))} type="checkbox" />
              {label}
            </label>
          ))}
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(7)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting} onClick={() => setStep(9)} type="button">Continue</button></div>
        </div>
      )}

      {step === 9 && (
        <div className="grid gap-4 rounded-xl border p-6">
          <p className="text-sm font-medium">Submit for verification</p>
          <p className="text-sm text-slate-600">Your profile will be saved and access to your dashboard unlocks immediately. You will not appear publicly or receive UmoAfric work assignments until UmoAfric has reviewed and approved your identity verification.</p>
          <div className="flex justify-between"><button className="text-sm font-semibold text-slate-600" onClick={() => setStep(8)} type="button">← Back</button><button className="rounded bg-brand px-6 py-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting} onClick={finalSubmit} type="button">{submitting ? "Submitting…" : "Submit for verification"}</button></div>
        </div>
      )}
    </div>
  );
}
