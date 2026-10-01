"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";
import { trackEvent } from "@/platform/analytics";

type Category = {
  id: string;
  key: string;
  name: string;
  parentId?: string | null;
  parent?: { id: string; key: string; name: string; sortOrder: number } | null;
};
type Organisation = { id: string; name: string };
type DocumentRequirement = {
  evidenceType: string;
  label: string;
  description: string | null;
  required: boolean;
};
type ServiceArea = { countryCode: string; region: string; city: string };

const STEP_LABELS = [
  "Account type",
  "Business information",
  "Services",
  "Service areas",
  "Identity verification",
  "Business documents",
  "Portfolio",
  "WhatsApp notifications",
  "Review & consent",
  "Submit",
];

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function uploadEvidence(
  providerId: string,
  evidenceType: string,
  file: File,
) {
  const response = await fetch(
    `/api/providers/${providerId}/verification/evidence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        dataBase64: await fileToBase64(file),
        evidenceType,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    const code = body.error?.code;
    if (
      code === "STORAGE_NOT_CONFIGURED" ||
      code === "STORAGE_PRIVATE_NOT_CONFIGURED" ||
      code === "STORAGE_PUBLIC_NOT_CONFIGURED"
    ) {
      throw new Error(
        "Document upload is temporarily unavailable. Please try again later.",
      );
    }
    throw new Error(body.error?.message ?? `Unable to upload ${evidenceType}.`);
  }
  // Only forward type/reference — the raw evidence row also carries `expiresAt: null`, which
  // `z.coerce.date()` on the verification-submit schema turns into the Unix epoch (a very
  // definitely-expired date) rather than leaving it absent.
  return {
    type: body.attached.type as string,
    reference: body.attached.reference as string,
  };
}

/** What the server saved (create and update both return it): the review step shows this. */
type SavedProvider = {
  id: string;
  type: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  categories: { category: { id: string; name: string } }[];
  serviceAreas: { id: string; name: string }[];
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: { providerId?: string };
  };
};

async function readError(response: Response): Promise<ApiErrorBody["error"]> {
  try {
    return ((await response.json()) as ApiErrorBody).error ?? {};
  } catch {
    return {};
  }
}

/**
 * What to tell the person when a step fails, from the server's error code. The profile may
 * already exist at the later steps, so those messages never suggest starting over.
 */
export function providerOnboardingErrorMessage(
  status: number,
  error: ApiErrorBody["error"],
  fallback: string,
) {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  switch (error?.code) {
    case "INVALID_VERIFICATION_STATE":
      return "Your profile has already been submitted for verification. Open your workspace to follow its progress.";
    case "CONTACT_NOT_READY":
      return "Add a contact email or phone number to your profile before submitting for verification.";
    case "EXPIRED_PROVIDER_EVIDENCE":
      return "One of your documents has expired. Upload a current one and try again.";
    case "VALIDATION_ERROR":
      return fallback;
    default:
      return error?.message ?? fallback;
  }
}

export function ServiceProviderOnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard: two clicks in the same frame both see `submitting === false`.
  const inFlight = useRef(false);
  // The profile exists but a later step failed: the workspace is still open to its owner.
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [saved, setSaved] = useState<SavedProvider | null>(null);
  // `providerId` came from an earlier profile (409), not from this form's own create.
  const [adoptedExisting, setAdoptedExisting] = useState(false);

  const [accountType, setAccountType] = useState<"INDIVIDUAL" | "COMPANY">(
    "INDIVIDUAL",
  );
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [companyOrganisationId, setCompanyOrganisationId] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [biography, setBiography] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([
    { countryCode: "GH", region: "", city: "" },
  ]);

  const [providerId, setProviderId] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([]);



  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [whatsappPreferences, setWhatsappPreferences] = useState({
    inquiryNotifications: true,
    viewingNotifications: true,
    leadNotifications: true,
    savedPropertyNotifications: true,
    bookingNotifications: true,
    serviceRequestNotifications: true,
    messageNotifications: true,
    reviewNotifications: true,
    accountActivityNotifications: true,
  });
  const [identityFiles, setIdentityFiles] = useState<Record<string, File | null>>({});
  const [businessFiles, setBusinessFiles] = useState<Record<string, File | null>>({});
  const [portfolioFile, setPortfolioFile] = useState<File | null>(null);

  const [submittedEvidence, setSubmittedEvidence] = useState<
    { type: string; reference: string }[]
  >([]);

  const [consent, setConsent] = useState({
    accurate: false,
    authorized: false,
    reviewConsented: false,
    termsAccepted: false,
  });

  useEffect(() => {
    fetch("/api/providers/categories")
      .then(async (response) => {
        if (response.ok) setCategories(await response.json());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (accountType !== "COMPANY") return;
    fetch("/api/organisations")
      .then(async (response) => {
        if (response.ok) setOrganisations(await response.json());
      })
      .catch(() => {});
  }, [accountType]);

  const identityRequirements = requirements.filter((requirement) =>
    requirement.evidenceType.startsWith("GHANA_CARD"),
  );
  const businessRequirements = requirements.filter(
    (requirement) => !requirement.evidenceType.startsWith("GHANA_CARD"),
  );

  const categoryGroups = Array.from(
    categories
      .reduce((groups, category) => {
        const key = category.parent?.id ?? "other";
        const current = groups.get(key) ?? {
          id: key,
          name: category.parent?.name ?? "Other property services",
          sortOrder: category.parent?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          categories: [] as Category[],
        };
        current.categories.push(category);
        groups.set(key, current);
        return groups;
      }, new Map<string, { id: string; name: string; sortOrder: number; categories: Category[] }>())
      .values(),
  ).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  function updateServiceArea(index: number, patch: Partial<ServiceArea>) {
    setServiceAreas((current) =>
      current.map((area, position) =>
        position === index ? { ...area, ...patch } : area,
      ),
    );
  }

  async function loadRequirements() {
    const requirementParams = new URLSearchParams({
      countryCode: "GH",
      providerType: accountType,
    });
    for (const categoryId of categoryIds)
      requirementParams.append("categoryId", categoryId);
    const requirementResponse = await fetch(
      `/api/public/providers/document-requirements?${requirementParams}`,
    );
    if (requirementResponse.ok)
      setRequirements(await requirementResponse.json());
  }

  const editableServiceAreas = () =>
    serviceAreas.filter((area) => area.city || area.region);

  /** The provider's own marketplace profile keeps the structured areas (best effort, as on create). */
  async function syncMarketplaceProfile(id: string) {
    await fetch("/api/marketplace/providers/" + id + "/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryIds,
        serviceAreas: editableServiceAreas().map((area) => ({
          countryCode: area.countryCode,
          region: area.region || undefined,
          city: area.city || undefined,
        })),
      }),
    }).catch(() => {});
  }

  /**
   * The profile already exists (the person went Back and edited): save the edits to that provider
   * through the owner-checked update route, never a second create. Empty optional fields clear.
   */
  async function updateExistingProvider(id: string) {
    const response = await fetch(`/api/providers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName,
        legalName: legalName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        biography: biography || null,
        categoryIds,
        serviceAreas: editableServiceAreas().map((area) => ({
          areaType: "SERVICE_AREA",
          name: [area.city, area.region, area.countryCode]
            .filter(Boolean)
            .join(", "),
        })),
      }),
    });
    if (!response.ok) {
      setWorkspaceReady(true);
      throw new Error(
        `${providerOnboardingErrorMessage(response.status, await readError(response), "We couldn’t save your changes.")} Your profile is saved as it was: you can try again, or open your workspace and edit it there.`,
      );
    }
    setSaved(await response.json());
    await syncMarketplaceProfile(id);
  }

  async function submitIdentityDocuments() {
    if (!providerId) return;

    const missing = identityRequirements.filter(
      (requirement) =>
        requirement.required && !identityFiles[requirement.evidenceType],
    );

    if (missing.length) {
      setError(
        `Please upload: ${missing.map((requirement) => requirement.label).join(", ")}.`,
      );
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const uploaded: { type: string; reference: string }[] = [];

      for (const requirement of identityRequirements) {
        const file = identityFiles[requirement.evidenceType];
        if (!file) continue;

        uploaded.push(
          await uploadEvidence(providerId, requirement.evidenceType, file),
        );
      }

      setSubmittedEvidence((current) => [...current, ...uploaded]);
      setStep(6);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload identity documents.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBusinessDocuments() {
    if (!providerId) return;

    const missing = businessRequirements.filter(
      (requirement) =>
        requirement.required && !businessFiles[requirement.evidenceType],
    );

    if (missing.length) {
      setError(
        `Please upload: ${missing.map((requirement) => requirement.label).join(", ")}.`,
      );
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const uploaded: { type: string; reference: string }[] = [];

      for (const requirement of businessRequirements) {
        const file = businessFiles[requirement.evidenceType];
        if (!file) continue;

        uploaded.push(
          await uploadEvidence(providerId, requirement.evidenceType, file),
        );
      }

      setSubmittedEvidence((current) => [...current, ...uploaded]);
      setStep(7);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload business documents.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPortfolio() {
    if (!providerId) {
      setStep(8);
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      if (portfolioFile) {
        await uploadEvidence(
          providerId,
          "PORTFOLIO_EVIDENCE",
          portfolioFile,
        );
      }

      setStep(8);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload portfolio evidence.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function createProviderAndFetchRequirements() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    setSubmitting(true);
    try {
      // A profile this account already had (found through the 409): never overwrite it with this
      // form. Its workspace is the place to edit it.
      if (providerId && adoptedExisting) {
        setWorkspaceReady(true);
        setError(
          "You already have a service provider profile. Open your workspace to edit it.",
        );
        return;
      }
      // Already created in this session (Back, then Continue again): never create a second one;
      // save whatever was edited on the way back before moving on.
      if (providerId) {
        await updateExistingProvider(providerId);
        await loadRequirements();
        setStep(5);
        return;
      }
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: accountType,
          companyOrganisationId:
            accountType === "COMPANY" ? companyOrganisationId : undefined,
          displayName,
          legalName: legalName || undefined,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          biography: biography || undefined,
          categoryIds,
          serviceAreas: editableServiceAreas().map((area) => ({
            areaType: "SERVICE_AREA",
            name: [area.city, area.region, area.countryCode]
              .filter(Boolean)
              .join(", "),
          })),
        }),
      });
      if (!response.ok) {
        const failure = await readError(response);
        // This account already has a profile (an earlier attempt or another tab): open it.
        if (
          failure?.code === "PROVIDER_IDENTITY_EXISTS" &&
          failure.details?.providerId
        ) {
          setProviderId(failure.details.providerId);
          setAdoptedExisting(true);
          setWorkspaceReady(true);
          setError(
            "You already have a service provider profile. Open your workspace to continue setting it up.",
          );
          return;
        }
        throw new Error(
          providerOnboardingErrorMessage(
            response.status,
            failure,
            "We couldn’t create your service provider profile. Check your details and try again.",
          ),
        );
      }
      const body = await response.json();
      setProviderId(body.id);
      setSaved(body);
      await syncMarketplaceProfile(body.id);

      await loadRequirements();

      trackCampaignEvent("service_provider_registration_started");
      setStep(5);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create your service-provider profile.",
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function openWorkspace() {
    if (providerId) router.push(`/providers/${providerId}`);
  }

  /**
   * Finishing onboarding opens the provider's private workspace. Submitting for verification is
   * part of it only when there is evidence to submit: public verification never gates access to
   * the owner's own workspace, where documents can be added later.
   */
  async function finalSubmit() {
    if (!providerId || inFlight.current) return;
    if (
      !consent.accurate ||
      !consent.authorized ||
      !consent.reviewConsented ||
      !consent.termsAccepted
    ) {
      return setError(
        "All four consent statements must be confirmed before submitting for review.",
      );
    }
    inFlight.current = true;
    setError("");
    setSubmitting(true);
    try {
      if (!consentRecorded) {
        const consentResponse = await fetch(
          `/api/providers/${providerId}/verification/consent`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: "2026-08-28", ...consent }),
          },
        );
        if (!consentResponse.ok) {
          throw new Error(
            providerOnboardingErrorMessage(
              consentResponse.status,
              await readError(consentResponse),
              "We couldn’t record your consent. Try again.",
            ),
          );
        }
        setConsentRecorded(true);
      }

      if (submittedEvidence.length) {
        const verificationResponse = await fetch(
          `/api/providers/${providerId}/verification`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ evidence: submittedEvidence }),
          },
        );
        if (!verificationResponse.ok) {
          throw new Error(
            providerOnboardingErrorMessage(
              verificationResponse.status,
              await readError(verificationResponse),
              "We couldn’t submit your documents for verification.",
            ),
          );
        }
      }

      trackCampaignEvent("service_provider_registration_completed");
      trackEvent("onboarding_completed", {
        onboarding_type: "offer_property_services",
      });
      openWorkspace();
    } catch (cause) {
      setWorkspaceReady(true);
      setError(
        `${cause instanceof Error ? cause.message : "We couldn’t submit your verification."} Your profile is saved: you can open your workspace and finish verification there.`,
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8 grid gap-6">
      <div className="flex flex-wrap gap-2 text-xs font-medium text-muted">
        {STEP_LABELS.map((label, index) => (
          <span
            className={`rounded-full px-3 py-1 ${index + 1 === step ? "bg-forest text-ink" : index + 1 < step ? "bg-surface" : "bg-surface"}`}
            key={label}
          >
            {index + 1}. {label}
          </span>
        ))}
      </div>

      {error && (
        <p
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {workspaceReady && providerId && (
        <button
          className="justify-self-start rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover"
          data-testid="provider-open-workspace"
          onClick={openWorkspace}
          type="button"
        >
          Open your service provider workspace
        </button>
      )}

      {step === 1 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">
            Are you registering as an individual or a company?
          </p>
          {/* A provider's type (and its company) is fixed once the profile exists: one identity per person or company. */}
          {providerId && (
            <p
              className="text-sm text-muted"
              data-testid="provider-type-locked"
            >
              Your profile is already created as{" "}
              {accountType === "INDIVIDUAL" ? "an individual" : "a company"}.
              This can’t be changed here.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              aria-pressed={accountType === "INDIVIDUAL"}
              className={`rounded-xl border border-hairline p-4 text-left disabled:cursor-not-allowed disabled:text-muted ${accountType === "INDIVIDUAL" ? "border-brand bg-forest/5" : ""}`}
              disabled={Boolean(providerId)}
              onClick={() => setAccountType("INDIVIDUAL")}
              type="button"
            >
              <p className="font-semibold">Individual / artisan</p>
              <p className="mt-1 text-sm text-muted">
                You work independently — plumber, electrician, agent, etc.
              </p>
            </button>
            <button
              aria-pressed={accountType === "COMPANY"}
              className={`rounded-xl border border-hairline p-4 text-left disabled:cursor-not-allowed disabled:text-muted ${accountType === "COMPANY" ? "border-brand bg-forest/5" : ""}`}
              disabled={Boolean(providerId)}
              onClick={() => setAccountType("COMPANY")}
              type="button"
            >
              <p className="font-semibold">Company / business</p>
              <p className="mt-1 text-sm text-muted">
                A registered business with a team — contractor, facilities
                company, etc.
              </p>
            </button>
          </div>
          {accountType === "COMPANY" && (
            <label className="text-sm font-medium">
              Which organisation is this business?
              <select
                className="mt-1 w-full rounded border p-3"
                disabled={Boolean(providerId)}
                onChange={(event) =>
                  setCompanyOrganisationId(event.target.value)
                }
                value={companyOrganisationId}
              >
                <option value="">Select an organisation</option>
                {organisations.map((organisation) => (
                  <option key={organisation.id} value={organisation.id}>
                    {organisation.name}
                  </option>
                ))}
              </select>
              {organisations.length === 0 && (
                <span className="mt-1 block text-xs text-muted">
                  No organisations found — create one first, then return to this
                  page.
                </span>
              )}
            </label>
          )}
          <button
            className="rounded bg-forest p-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
            disabled={accountType === "COMPANY" && !companyOrganisationId}
            onClick={() => setStep(2)}
            type="button"
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <label className="text-sm font-medium">
            Business / display name
            <input
              className="mt-1 w-full rounded border p-3"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Kofi Mensah Electrical"
              required
              value={displayName}
            />
          </label>
          <label className="text-sm font-medium">
            Legal name{" "}
            <span className="font-normal text-muted">(optional)</span>
            <input
              className="mt-1 w-full rounded border p-3"
              onChange={(event) => setLegalName(event.target.value)}
              value={legalName}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Contact email
              <input
                className="mt-1 w-full rounded border p-3"
                onChange={(event) => setContactEmail(event.target.value)}
                type="email"
                value={contactEmail}
              />
            </label>
            <label className="text-sm font-medium">
              Contact phone
              <input
                className="mt-1 w-full rounded border p-3"
                onChange={(event) => setContactPhone(event.target.value)}
                value={contactPhone}
              />
            </label>
          </div>
          <label className="text-sm font-medium">
            Description{" "}
            <span className="font-normal text-muted">(optional)</span>
            <textarea
              className="mt-1 w-full rounded border p-3"
              onChange={(event) => setBiography(event.target.value)}
              rows={4}
              value={biography}
            />
          </label>
          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(1)}
              type="button"
            >
              ← Back
            </button>
            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={!displayName || (!contactEmail && !contactPhone)}
              onClick={() => setStep(3)}
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">Which services do you offer?</p>
          <div className="grid gap-5">
            {categoryGroups.map((group) => (
              <fieldset className="grid gap-2" key={group.id}>
                <legend className="text-sm font-semibold">{group.name}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.categories.map((category) => (
                    <label
                      className="flex items-center gap-2 rounded-xl border border-hairline p-3 text-sm"
                      key={category.id}
                    >
                      <input
                        checked={categoryIds.includes(category.id)}
                        onChange={(event) =>
                          setCategoryIds((current) =>
                            event.target.checked
                              ? current.includes(category.id)
                                ? current
                                : [...current, category.id]
                              : current.filter((id) => id !== category.id),
                          )
                        }
                        type="checkbox"
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(2)}
              type="button"
            >
              ← Back
            </button>
            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={!categoryIds.length}
              onClick={() => setStep(4)}
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">
            Where do you offer these services?
          </p>
          {serviceAreas.map((area, index) => (
            <div className="grid gap-3 sm:grid-cols-3" key={index}>
              <input
                className="rounded border bg-surface p-3 uppercase"
                readOnly
                value={area.countryCode}
              />
              <input
                className="rounded border p-3"
                onChange={(event) =>
                  updateServiceArea(index, { region: event.target.value })
                }
                placeholder="Region"
                value={area.region}
              />
              <input
                className="rounded border p-3"
                onChange={(event) =>
                  updateServiceArea(index, { city: event.target.value })
                }
                placeholder="City"
                value={area.city}
              />
            </div>
          ))}
          <button
            className="text-left text-sm font-semibold text-ink"
            onClick={() =>
              setServiceAreas((current) => [
                ...current,
                { countryCode: "GH", region: "", city: "" },
              ])
            }
            type="button"
          >
            + Add another area
          </button>
          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(3)}
              type="button"
            >
              ← Back
            </button>
            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={
                submitting ||
                !serviceAreas.some((area) => area.city || area.region)
              }
              onClick={createProviderAndFetchRequirements}
              type="button"
            >
              {providerId
                ? submitting
                  ? "Saving…"
                  : "Save & continue"
                : submitting
                  ? "Creating profile…"
                  : "Create profile & continue"}
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">Mandatory identity verification</p>
          <p className="text-sm text-muted">
            NesAfric requires identity verification to help keep the marketplace safe and trustworthy.
            Your verification documents are private and are not shown publicly.
          </p>

          {identityRequirements.map((requirement) => (
            <label className="text-sm font-medium" key={requirement.evidenceType}>
              {requirement.label}
              {requirement.required && <span className="text-red-600"> *</span>}
              <input
                accept="image/*"
                capture="environment"
                className="mt-1 w-full rounded border border-hairline p-3"
                onChange={(event) =>
                  setIdentityFiles((current) => ({
                    ...current,
                    [requirement.evidenceType]:
                      event.target.files?.[0] ?? null,
                  }))
                }
                type="file"
              />
            </label>
          ))}

          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(4)}
              type="button"
            >
              ← Back
            </button>

            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={submitting}
              onClick={submitIdentityDocuments}
              type="button"
            >
              {submitting ? "Uploading…" : "Continue"}
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">
            Business & credential documents
          </p>

          {businessRequirements.length === 0 ? (
            <p className="text-sm text-muted">
              No additional documents are required for your account type and services.
            </p>
          ) : (
            businessRequirements.map((requirement) => (
              <label
                className="text-sm font-medium"
                key={requirement.evidenceType}
              >
                {requirement.label}
                {requirement.required && (
                  <span className="text-red-600"> *</span>
                )}

                <input
                  accept="image/*,application/pdf"
                  className="mt-1 w-full rounded border border-hairline p-3"
                  onChange={(event) =>
                    setBusinessFiles((current) => ({
                      ...current,
                      [requirement.evidenceType]:
                        event.target.files?.[0] ?? null,
                    }))
                  }
                  type="file"
                />
              </label>
            ))
          )}

          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(5)}
              type="button"
            >
              ← Back
            </button>

            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={submitting}
              onClick={submitBusinessDocuments}
              type="button"
            >
              {submitting ? "Uploading…" : "Continue"}
            </button>
          </div>
        </div>
      )}

      {step === 7 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">
            Portfolio <span className="font-normal text-muted">(optional)</span>
          </p>

          <p className="text-sm text-muted">
            Show examples of your past work. You can add more later from your workspace.
          </p>

          <input
            accept="image/*"
            className="rounded border border-hairline p-3"
            onChange={(event) =>
              setPortfolioFile(event.target.files?.[0] ?? null)
            }
            type="file"
          />

          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(6)}
              type="button"
            >
              ← Back
            </button>

            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={submitting}
              onClick={submitPortfolio}
              type="button"
            >
              {submitting ? "Saving…" : "Continue"}
            </button>
          </div>
        </div>
      )}

      {step === 8 && (
        <div className="grid gap-5 rounded-xl border border-hairline p-6">
          <div className="grid gap-2">
            <p className="text-sm font-medium">WhatsApp notifications</p>
            <p className="text-sm text-muted">
              Add the WhatsApp number where you want NesAfric to send important
              business alerts. Your number must be verified before WhatsApp
              notifications can be delivered.
            </p>
          </div>

          <label className="grid gap-1 text-sm font-medium">
            Business WhatsApp number
            <input
              className="rounded border p-3"
              onChange={(event) => setWhatsappNumber(event.target.value)}
              placeholder="e.g. 024 123 4567"
              type="tel"
              value={whatsappNumber}
            />
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              checked={whatsappOptIn}
              className="mt-1"
              onChange={(event) => setWhatsappOptIn(event.target.checked)}
              type="checkbox"
            />
            <span>
              I agree to receive NesAfric business notifications on this
              WhatsApp number. I can turn them off later.
            </span>
          </label>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">
              Choose the notifications you want
            </legend>

            {[
              ["inquiryNotifications", "Property and customer inquiries"],
              ["viewingNotifications", "Viewing requests and updates"],
              ["leadNotifications", "New leads"],
              ["savedPropertyNotifications", "Saved or liked property activity"],
              ["bookingNotifications", "Bookings"],
              ["serviceRequestNotifications", "Service requests"],
              ["messageNotifications", "Customer messages"],
              ["reviewNotifications", "Reviews"],
              ["accountActivityNotifications", "Important account activity"],
            ].map(([key, label]) => (
              <label className="flex items-start gap-2 text-sm" key={key}>
                <input
                  checked={
                    whatsappPreferences[
                      key as keyof typeof whatsappPreferences
                    ]
                  }
                  className="mt-1"
                  onChange={(event) =>
                    setWhatsappPreferences((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                {label}
              </label>
            ))}
          </fieldset>

          <p className="text-xs text-muted">
            WhatsApp delivery remains disabled until this number is verified.
          </p>

          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(7)}
              type="button"
            >
              ← Back
            </button>

            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={submitting || (whatsappOptIn && !whatsappNumber.trim())}
              onClick={async () => {
                if (!providerId) {
                  setStep(9);
                  return;
                }

                if (!whatsappNumber.trim() && !whatsappOptIn) {
                  setStep(9);
                  return;
                }

                setSubmitting(true);
                setError("");

                try {
                  const response = await fetch(
                    `/api/providers/${providerId}/whatsapp-notifications`,
                    {
                      method: "PUT",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        whatsappNumber,
                        whatsappOptIn,
                        ...whatsappPreferences,
                      }),
                    },
                  );

                  if (!response.ok) {
                    const body = await response.json().catch(() => ({}));

                    setError(
                      providerOnboardingErrorMessage(
                        response.status,
                        body,
                        "We could not save your WhatsApp notification settings.",
                      ),
                    );

                    return;
                  }

                  setStep(9);
                } catch {
                  setError(
                    "We could not save your WhatsApp notification settings. Please try again.",
                  );
                } finally {
                  setSubmitting(false);
                }
              }}
              type="button"
            >
              {submitting ? "Saving…" : "Save & continue"}
            </button>
          </div>
        </div>
      )}

      {step === 9 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">Review & consent</p>
          {/* What NesAfric saved, not the form's local state. */}
          {saved && (
            <div
              className="rounded-lg bg-surface p-4 text-sm text-ink"
              data-testid="provider-review-saved"
            >
              <p>
                <strong>{saved.displayName}</strong> ·{" "}
                {saved.type === "INDIVIDUAL" ? "Individual" : "Company"}
              </p>
              <p className="mt-1">
                Services:{" "}
                {saved.categories
                  .map(({ category }) => category.name)
                  .join(", ") || "None"}
              </p>
              <p className="mt-1">
                Service areas:{" "}
                {saved.serviceAreas.map((area) => area.name).join("; ") ||
                  "None"}
              </p>
              <p className="mt-1">
                Contact:{" "}
                {[saved.contactEmail, saved.contactPhone]
                  .filter(Boolean)
                  .join(" · ") || "None"}
              </p>
              <p className="mt-1">
                {submittedEvidence.length} document
                {submittedEvidence.length === 1 ? "" : "s"} uploaded
              </p>
            </div>
          )}
          {[
            [
              "accurate",
              "I confirm the information I have provided is accurate.",
            ],
            [
              "authorized",
              "I confirm the uploaded documents belong to me, or to a person I am authorised to represent.",
            ],
            [
              "reviewConsented",
              "I consent to NesAfric reviewing my verification evidence.",
            ],
            [
              "termsAccepted",
              "I agree to the NesAfric service-provider terms and privacy requirements.",
            ],
          ].map(([key, label]) => (
            <label className="flex items-start gap-2 text-sm" key={key}>
              <input
                checked={consent[key as keyof typeof consent]}
                className="mt-1"
                onChange={(event) =>
                  setConsent((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              {label}
            </label>
          ))}
          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(8)}
              type="button"
            >
              ← Back
            </button>
            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={submitting}
              onClick={() => setStep(10)}
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 10 && (
        <div className="grid gap-4 rounded-xl border border-hairline p-6">
          <p className="text-sm font-medium">Submit for verification</p>
          {!submittedEvidence.length && (
            <p
              className="text-sm text-muted"
              data-testid="provider-no-evidence-note"
            >
              You haven’t uploaded verification documents yet. Your workspace
              opens now; upload them there to be reviewed.
            </p>
          )}
          <p className="text-sm text-muted">
            Your profile will be saved and access to your dashboard unlocks
            immediately. You will not appear publicly or receive NesAfric work
            assignments until NesAfric has reviewed and approved your identity
            verification.
          </p>
          <div className="flex justify-between">
            <button
              className="text-sm font-semibold text-muted"
              onClick={() => setStep(9)}
              type="button"
            >
              ← Back
            </button>
            <button
              className="rounded bg-forest px-6 py-3 font-semibold text-ink transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
              disabled={submitting}
              onClick={finalSubmit}
              type="button"
            >
              {submitting
                ? "Submitting…"
                : submittedEvidence.length
                  ? "Submit for verification"
                  : "Finish and open workspace"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
