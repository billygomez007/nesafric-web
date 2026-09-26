"use client";

import Link from "next/link";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { MarketplaceLogoUploader } from "@/components/marketplace-logo-uploader";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass, fieldLabelClass, textareaClass } from "@/components/ui/field-styles";
import { ErrorState, LoadingState } from "@/components/ui/states";

type Profile = {
  id: string;
  slug: string;
  type: string;
  countryCode: string;
  status: string;
  verificationStatus: string;
  displayName: string;
  legalName: string | null;
  logoUrl: string | null;
  description: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  specialities: string[];
  servicesOffered: string[];
  serviceAreas: string[];
  myRole: "OWNER" | "ADMIN" | "AGENT";
};

type Form = {
  displayName: string;
  legalName: string;
  description: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
  specialities: string[];
  servicesOffered: string[];
  serviceAreas: string[];
};

type TextField = "displayName" | "legalName" | "description" | "websiteUrl" | "contactEmail" | "contactPhone";
type ListField = "specialities" | "servicesOffered" | "serviceAreas";

const TEXT_FIELDS: TextField[] = ["displayName", "legalName", "description", "websiteUrl", "contactEmail", "contactPhone"];
const LIST_FIELDS: ListField[] = ["specialities", "servicesOffered", "serviceAreas"];
const LIST_LIMITS: Record<ListField, number> = { specialities: 80, servicesOffered: 80, serviceAreas: 120 };

function toForm(profile: Profile): Form {
  return {
    displayName: profile.displayName,
    legalName: profile.legalName ?? "",
    description: profile.description ?? "",
    websiteUrl: profile.websiteUrl ?? "",
    contactEmail: profile.contactEmail ?? "",
    contactPhone: profile.contactPhone ?? "",
    specialities: profile.specialities,
    servicesOffered: profile.servicesOffered,
    serviceAreas: profile.serviceAreas,
  };
}

function humanize(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Accepts "example.com" as well as a full URL; the API stores a full URL. */
function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function validate(form: Form) {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (!form.displayName.trim()) errors.displayName = "Enter the business name.";
  const website = normalizeWebsite(form.websiteUrl);
  if (website) {
    try { new URL(website); } catch { errors.websiteUrl = "Enter a valid website address."; }
  }
  if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) errors.contactEmail = "Enter a valid email address.";
  return errors;
}

/** Only fields that changed are sent, so nothing the business didn't touch is overwritten.
 * Cleared optional fields are sent as null. */
function changes(original: Form, form: Form) {
  const patch: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    const next = field === "websiteUrl" ? normalizeWebsite(form[field]) : form[field].trim();
    if (next === original[field].trim()) continue;
    patch[field] = next === "" && field !== "displayName" ? null : next;
  }
  for (const field of LIST_FIELDS) {
    if (JSON.stringify(form[field]) !== JSON.stringify(original[field])) patch[field] = form[field];
  }
  return patch;
}

function TagInput({ id, label, hint, values, onChange, disabled, maxLength }: {
  id: string;
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  maxLength: number;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const additions = draft.split(",").map((value) => value.trim().slice(0, maxLength)).filter(Boolean);
    const next = [...values];
    for (const value of additions) {
      if (!next.some((existing) => existing.toLowerCase() === value.toLowerCase()) && next.length < 50) next.push(value);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commit(); }
    if (event.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  }

  return (
    <div>
      <label className={fieldLabelClass} htmlFor={id}>{label}</label>
      <div className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border border-hairline bg-white px-2 py-1.5 ${disabled ? "bg-surface" : "focus-within:border-forest focus-within:ring-2 focus-within:ring-forest/10"}`}>
        {values.map((value) => (
          <span className="inline-flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-[13px] text-ink" key={value}>
            {value}
            {!disabled && (
              <button aria-label={`Remove ${value}`} className="rounded-full px-1 text-muted hover:text-danger-ink" onClick={() => onChange(values.filter((entry) => entry !== value))} type="button">×</button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-slate-500"
            id={id}
            onBlur={commit}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={values.length ? "Add another" : "Type and press Enter"}
            value={draft}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 border-t border-hairline py-8 first:border-t-0 first:pt-0 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="text-base font-semibold text-forest-deep">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
      </div>
      <div className="grid min-w-0 gap-5">{children}</div>
    </section>
  );
}

/**
 * The business's own marketplace profile editor. Reads and writes the one
 * `MarketplaceProfessional` record through the business endpoints (membership-authorized):
 * OWNER and ADMIN can edit; AGENT sees the profile read-only.
 */
export function MarketplaceBusinessProfile({ professionalId }: { professionalId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/marketplace-professionals/${professionalId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? "The business profile could not be loaded.");
        setProfile(body as Profile);
        setForm(toForm(body as Profile));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : "The business profile could not be loaded.");
      });
    return () => controller.abort();
  }, [professionalId]);

  const original = useMemo(() => (profile ? toForm(profile) : null), [profile]);
  const patch = useMemo(() => (original && form ? changes(original, form) : {}), [original, form]);
  const dirty = Object.keys(patch).length > 0;

  // Unsaved-changes protection for reloads, tab closes and external navigation.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!profile || !form) {
    return loadError
      ? <ErrorState message={loadError} title="Business profile unavailable" />
      : <LoadingState label="Loading business profile" />;
  }

  const canEdit = profile.myRole === "OWNER" || profile.myRole === "ADMIN";
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    setSaved("");
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !dirty) return;
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setError("Check the highlighted fields."); return; }
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch(`/api/marketplace-professionals/${professionalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) {
        const issues = (body?.error?.issues ?? []) as Array<{ path: string; message: string }>;
        if (issues.length) setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.path.split(".")[0], "This value is not valid."])));
        throw new Error(body?.error?.message ?? "Your changes could not be saved.");
      }
      const next = { ...profile!, ...body, myRole: profile!.myRole } as Profile;
      setProfile(next);
      setForm(toForm(next));
      setSaved("Business profile saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (original) setForm(original);
    setFieldErrors({});
    setError("");
  }

  const textInput = (field: TextField, label: string, options: { type?: string; placeholder?: string; autoComplete?: string; maxLength?: number } = {}) => (
    <div>
      <label className={fieldLabelClass} htmlFor={`profile-${field}`}>{label}</label>
      <input
        aria-describedby={fieldErrors[field] ? `profile-${field}-error` : undefined}
        aria-invalid={Boolean(fieldErrors[field])}
        autoComplete={options.autoComplete}
        className={`${controlClass} ${fieldErrors[field] ? "border-danger" : ""} disabled:bg-surface`}
        disabled={!canEdit || saving}
        id={`profile-${field}`}
        maxLength={options.maxLength}
        onChange={(event) => set(field, event.target.value)}
        placeholder={options.placeholder}
        type={options.type ?? "text"}
        value={form[field]}
      />
      {fieldErrors[field] && <p className="mt-1 text-xs text-danger-ink" id={`profile-${field}-error`}>{fieldErrors[field]}</p>}
    </div>
  );

  const publicProfileHref = `/marketplace/professionals/${profile.slug}`;

  return (
    <div className="mx-auto w-full max-w-5xl pb-28">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">Business profile</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">Profile & branding</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            How {profile.displayName} appears on the NesAfric marketplace: your public profile, the directory and, if featured, the homepage.
          </p>
        </div>
        <Link className={buttonClass("secondary", "sm")} href={publicProfileHref} target="_blank">View public profile ↗</Link>
      </header>

      {!canEdit && (
        <p className="mb-6 border-l-2 border-gold bg-warning-tint px-4 py-3 text-sm text-ink" role="status">
          You can view this profile. Only owners and admins of {profile.displayName} can change it.
        </p>
      )}
      {profile.status !== "ACTIVE" && (
        <p className="mb-6 border-l-2 border-danger bg-danger-tint px-4 py-3 text-sm text-danger-ink" role="status">
          This account is {profile.status.toLowerCase()}, so the public profile is currently hidden.
        </p>
      )}

      <form noValidate onSubmit={save}>
        <div className="rounded-[var(--radius-panel)] border border-hairline bg-white px-5 py-8 sm:px-8">
          <Section description="Your logo is used everywhere the business appears on NesAfric." title="Branding">
            <MarketplaceLogoUploader
              canEdit={canEdit}
              endpoint={`/api/marketplace-professionals/${professionalId}/logo`}
              logoUrl={profile.logoUrl}
              name={profile.displayName}
              onChange={(logoUrl) => setProfile((current) => (current ? { ...current, logoUrl } : current))}
            />
          </Section>

          <Section description="The name customers see, and your registered name." title="Business identity">
            <div className="grid gap-5 sm:grid-cols-2">
              {textInput("displayName", "Business name", { autoComplete: "organization", maxLength: 200 })}
              {textInput("legalName", "Legal business name (optional)", { maxLength: 300 })}
            </div>
            <dl className="grid gap-5 sm:grid-cols-2">
              <div>
                <dt className={fieldLabelClass}>Business type</dt>
                <dd className="text-sm text-ink">{humanize(profile.type)}</dd>
              </div>
              <div>
                <dt className={fieldLabelClass}>Country</dt>
                <dd className="text-sm text-ink">{profile.countryCode}</dd>
              </div>
            </dl>
            <p className="-mt-2 text-xs text-muted">Business type and country are set when the profile is created. Contact NesAfric support to change them.</p>
          </Section>

          <Section description="A short introduction shown on your public profile." title="About">
            <div>
              <label className={fieldLabelClass} htmlFor="profile-description">Description</label>
              <textarea
                className={`${textareaClass} disabled:bg-surface`}
                disabled={!canEdit || saving}
                id="profile-description"
                maxLength={5000}
                onChange={(event) => set("description", event.target.value)}
                placeholder="What the business does, where it works and what makes it different."
                rows={6}
                value={form.description}
              />
              <p className="mt-1 text-right text-xs tabular-nums text-muted">{form.description.length} / 5000</p>
            </div>
          </Section>

          <Section description="Shown publicly so customers can reach you." title="Contact">
            {textInput("websiteUrl", "Website", { type: "url", placeholder: "www.example.com", autoComplete: "url", maxLength: 2000 })}
            <div className="grid gap-5 sm:grid-cols-2">
              {textInput("contactEmail", "Contact email", { type: "email", autoComplete: "email", maxLength: 320 })}
              {textInput("contactPhone", "Contact phone", { type: "tel", autoComplete: "tel", maxLength: 50 })}
            </div>
          </Section>

          <Section description="Helps customers find you in the marketplace directory." title="Services">
            <TagInput disabled={!canEdit || saving} hint="For example: Residential sales, Luxury homes." id="profile-specialities" label="Specialties" maxLength={LIST_LIMITS.specialities} onChange={(value) => set("specialities", value)} values={form.specialities} />
            <TagInput disabled={!canEdit || saving} hint="For example: Property management, Valuation." id="profile-services" label="Services offered" maxLength={LIST_LIMITS.servicesOffered} onChange={(value) => set("servicesOffered", value)} values={form.servicesOffered} />
            <TagInput disabled={!canEdit || saving} hint="Cities, districts or neighbourhoods. For example: East Legon, Kumasi." id="profile-areas" label="Service areas" maxLength={LIST_LIMITS.serviceAreas} onChange={(value) => set("serviceAreas", value)} values={form.serviceAreas} />
          </Section>
        </div>

        {canEdit && (
          <div className={`${dirty || saving ? "sticky bottom-0 z-20 shadow-[0_-8px_24px_rgba(0,47,43,0.08)]" : ""} -mx-4 mt-6 border-t border-hairline bg-warm-white/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-[var(--radius-panel)] sm:border`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div aria-live="polite" className="min-w-0 text-sm">
                {error ? <span className="font-medium text-danger-ink">{error}</span>
                  : saved ? <span className="font-medium text-success">{saved}</span>
                  : dirty ? <span className="text-muted">You have unsaved changes.</span>
                  : <span className="text-muted">All changes saved.</span>}
              </div>
              <div className="flex gap-2">
                <button className={buttonClass("secondary")} disabled={!dirty || saving} onClick={cancel} type="button">Cancel</button>
                <button className={buttonClass("primary")} disabled={!dirty || saving} type="submit">{saving ? "Saving…" : "Save changes"}</button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
