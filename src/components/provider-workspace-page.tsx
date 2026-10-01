"use client";

import { useEffect, useState } from "react";
import {
  ProviderDetail,
  type ProviderDetailSection,
} from "@/components/provider-detail";
import { ProviderWorkspaceShell } from "@/components/provider-workspace-shell";

type ProviderResponse = {
  provider: {
    id: string;
    displayName: string;
  };
};

const SECTION_COPY: Record<
  ProviderDetailSection,
  { eyebrow: string; title: string; description: string }
> = {
  dashboard: {
    eyebrow: "Service Provider",
    title: "Dashboard",
    description:
      "Review your service activity, verification, availability and marketplace presence.",
  },
  profile: {
    eyebrow: "Service Provider",
    title: "Profile",
    description:
      "Manage the business information customers see across NesAfric Property Services.",
  },
  verification: {
    eyebrow: "Service Provider",
    title: "Verification",
    description:
      "Review your verification status, evidence and submission progress.",
  },
  jobs: {
    eyebrow: "Service Provider",
    title: "Jobs",
    description:
      "Review assignments, respond to pending work and follow completed jobs.",
  },
  availability: {
    eyebrow: "Service Provider",
    title: "Availability",
    description:
      "Control whether you are available and accepting new service requests.",
  },
};

export function ProviderWorkspacePage({
  providerId,
  section = "dashboard",
}: {
  providerId: string;
  section?: ProviderDetailSection;
}) {
  const [providerName, setProviderName] = useState("Service Provider");
  const [verificationStatus, setVerificationStatus] = useState("PENDING");
  const copy = SECTION_COPY[section];

  useEffect(() => {
    let cancelled = false;

    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );
    const headers: Record<string, string> = organisationId
      ? { "x-organisation-id": organisationId }
      : {};

    fetch(`/api/providers/${providerId}`, { headers })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ProviderResponse;
      })
      .then((result) => {
        if (!cancelled && result?.provider) {
          if (result.provider.displayName) {
            setProviderName(result.provider.displayName);
          }

          setVerificationStatus(
            (result.provider as { verificationStatus?: string })
              .verificationStatus ?? "PENDING",
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [providerId]);

  return (
    <ProviderWorkspaceShell
      providerId={providerId}
      providerName={providerName}
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">
            {copy.eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-forest">
            {copy.title}
          </h1>
          <p className="mt-1 text-sm text-muted">{copy.description}</p>
        </div>

        <div className="mb-6 rounded-xl border border-hairline bg-surface p-5">
          <p className="text-sm font-semibold text-forest">
            Verification status
          </p>

          <p className="mt-1 text-sm text-muted">
            {verificationStatus === "VERIFIED"
              ? "Your service provider profile is verified and eligible for marketplace visibility."
              : "Your profile is active. NesAfric will review your verification details and contact you if additional documents are required."}
          </p>

          <div className="mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold">
            {verificationStatus}
          </div>
        </div>

        <ProviderDetail providerId={providerId} section={section} />
      </div>
    </ProviderWorkspaceShell>
  );
}
