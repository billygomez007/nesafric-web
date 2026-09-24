"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { trackCampaignEvent } from "@/components/marketing/campaign-tracking";
import { trackEvent } from "@/platform/analytics";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");

      if (comma < 0) {
        reject(new Error("Unable to read the selected logo."));
        return;
      }

      resolve(result.slice(comma + 1));
    };

    reader.onerror = () =>
      reject(new Error("Unable to read the selected logo."));

    reader.readAsDataURL(file);
  });
}

export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  function selectLogo(file: File | null) {
    setError("");

    if (!file) {
      setLogo(null);
      setLogoPreview("");
      return;
    }

    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      setError("Company logo must be a PNG, JPEG or WebP image.");
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setError("Company logo must be 5 MB or smaller.");
      return;
    }

    setLogo(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const form = new FormData(event.currentTarget);

      const response = await fetch("/api/organisations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: form.get("name"),
          type: form.get("type"),
          countryCode: "GH",
          defaultCurrencyCode: "GHS",
        }),
      });

      const organisation = await response.json();

      if (!response.ok) {
        throw new Error(
          organisation?.error?.message ?? "Unable to create organisation.",
        );
      }

      localStorage.setItem(
        "propertyos.activeOrganisationId",
        organisation.id,
      );

      if (logo) {
        const uploadResponse = await fetch("/api/documents/uploads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-organisation-id": organisation.id,
          },
          body: JSON.stringify({
            targetType: "ORGANISATION_LOGO",
            targetId: organisation.id,
            fileName: logo.name,
            contentType: logo.type,
            dataBase64: await fileToBase64(logo),
            classification: "PUBLIC",
          }),
        });

        if (!uploadResponse.ok) {
          const uploadBody = await uploadResponse.json().catch(() => null);

          console.error(
            "Organisation created but company logo upload failed.",
            uploadBody,
          );
        }
      }

      trackCampaignEvent("manage_properties_registration_completed");
      trackEvent("onboarding_completed", {
        onboarding_type: "manage_properties",
      });

      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to complete organisation setup.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="mt-8 grid gap-4 rounded-2xl border border-hairline bg-white p-6 shadow-card"
      onSubmit={submit}
    >
      <label className="text-sm font-medium">
        Organisation name
        <input
          className="mt-1 w-full rounded-xl border border-hairline bg-white p-3"
          name="name"
          required
        />
      </label>

      <label className="text-sm font-medium">
        Organisation type
        <select
          className="mt-1 w-full rounded-xl border border-hairline bg-white p-3"
          name="type"
        >
          <option value="INDIVIDUAL_LANDLORD">Individual landlord</option>
          <option value="PROPERTY_MANAGEMENT">
            Property management company
          </option>
          <option value="REAL_ESTATE">Real estate company</option>
          <option value="DEVELOPER">Property developer</option>
          <option value="OTHER">Other</option>
        </select>
      </label>

      <div className="rounded-2xl border border-hairline bg-surface/40 p-4">
        <div className="flex items-start gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-white">
            {logoPreview ? (
              <img
                alt="Company logo preview"
                className="h-full w-full object-contain p-2"
                src={logoPreview}
              />
            ) : (
              <span className="px-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Your logo
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Company logo</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Optional. Upload your business logo to personalise your NesAfric
              workspace. PNG, JPEG or WebP, up to 5 MB.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-xl border border-hairline bg-white px-3.5 py-2 text-xs font-semibold text-forest transition hover:border-teal">
                {logo ? "Change logo" : "Choose logo"}
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) =>
                    selectLogo(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>

              {logo && (
                <button
                  className="rounded-xl px-3.5 py-2 text-xs font-semibold text-muted transition hover:bg-white hover:text-ink"
                  onClick={() => selectLogo(null)}
                  type="button"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm font-medium">
          Country
          <input
            className="mt-1 w-full rounded-xl border border-hairline bg-surface p-3"
            readOnly
            value="Ghana (GH)"
          />
        </label>

        <label className="text-sm font-medium">
          Default currency
          <input
            className="mt-1 w-full rounded-xl border border-hairline bg-surface p-3"
            readOnly
            value="GHS"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-800">{error}</p>}

      <button
        className="rounded bg-forest p-3 font-semibold text-white transition-colors hover:bg-forest-hover disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Setting up your workspace..." : "Continue to property setup"}
      </button>
    </form>
  );
}
