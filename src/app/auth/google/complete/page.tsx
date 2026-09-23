"use client";

import {
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";

type Workspaces = {
  propertyOsOrganisations: Array<{
    id: string;
    name: string;
  }>;
  marketplaceProfessionals: Array<{
    id: string;
    displayName: string;
  }>;
};

export default function GoogleAuthCompletePage() {
  const router = useRouter();

  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function resolveWorkspace() {
      try {
        const response = await fetch(
          "/api/workspaces",
          {
            cache: "no-store",
          },
        );

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        if (!response.ok) {
          throw new Error(
            "Unable to load your NesAfric workspace.",
          );
        }

        const workspaces =
          (await response.json()) as Workspaces;

        if (cancelled) return;

        const organisation =
          workspaces
            .propertyOsOrganisations?.[0];

        if (organisation) {
          localStorage.setItem(
            "propertyos.activeOrganisationId",
            organisation.id,
          );

          router.replace("/dashboard");
          router.refresh();
          return;
        }

        const professional =
          workspaces
            .marketplaceProfessionals?.[0];

        if (professional) {
          localStorage.setItem(
            "nesafric.activeMarketplaceProfessionalId",
            professional.id,
          );

          router.replace(
            `/pro/${professional.id}`,
          );

          router.refresh();
          return;
        }

        router.replace("/onboarding");
        router.refresh();
      } catch (cause) {
        if (cancelled) return;

        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to continue.",
        );
      }
    }

    void resolveWorkspace();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-warm-white px-6">
      <div className="w-full max-w-md rounded-3xl border border-hairline bg-white p-8 text-center shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          NESAFRIC
        </p>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-forest">
          {error
            ? "We could not open your workspace"
            : "Opening your workspace"}
        </h1>

        {error ? (
          <>
            <p
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900"
              role="alert"
            >
              {error}
            </p>

            <a
              className="mt-6 inline-flex rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white hover:bg-emerald"
              href="/login"
            >
              Return to sign in
            </a>
          </>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted">
            Your Google account has been verified. We are loading your NesAfric workspace.
          </p>
        )}
      </div>
    </main>
  );
}
