"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { trackEvent } from "@/platform/analytics";

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

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.55l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}

export function AuthForm({
  mode,
}: {
  mode: "register" | "login";
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resolveWorkspace(workspaces: Partial<Workspaces> | undefined) {
    if (
      !workspaces ||
      !Array.isArray(workspaces.propertyOsOrganisations) ||
      !Array.isArray(workspaces.marketplaceProfessionals)
    ) {
      return "/dashboard";
    }

    const organisation = workspaces.propertyOsOrganisations[0];

    if (organisation) {
      localStorage.setItem("propertyos.activeOrganisationId", organisation.id);

      return "/dashboard";
    }

    const professional = workspaces.marketplaceProfessionals[0];

    if (professional) {
      localStorage.setItem(
        "nesafric.activeMarketplaceProfessionalId",
        professional.id,
      );

      return `/pro/${professional.id}`;
    }

    return "/onboarding";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) return;

    setError("");
    setSubmitting(true);

    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));

      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error?.message ?? "Unable to continue.");
      }

      trackEvent(mode === "register" ? "sign_up" : "login", {
        method: "email",
      });

      const destination =
        typeof body.returnTo === "string" &&
        body.returnTo.startsWith("/")
          ? body.returnTo
          : mode === "register"
            ? "/onboarding"
            : resolveWorkspace(
                body.workspaces,
              );

      router.push(destination);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to continue.");

      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8">
      <a
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3.5 text-sm font-semibold text-forest transition hover:border-teal/40 hover:bg-warm-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        href="/api/auth/google/start"
      >
        <GoogleIcon />
        Continue with Google
      </a>

      <div aria-hidden="true" className="my-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-hairline" />

        <span className="text-xs font-medium uppercase tracking-[0.15em] text-muted">
          or
        </span>

        <div className="h-px flex-1 bg-hairline" />
      </div>

      <form className="space-y-5" onSubmit={submit}>
        {mode === "register" && (
          <label className="block text-sm font-semibold text-forest">
            Name
            <input
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-forest transition placeholder:text-muted focus:border-teal focus:ring-4 focus:ring-teal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              name="displayName"
              required
            />
          </label>
        )}

        <label className="block text-sm font-semibold text-forest">
          Email
          <input
            autoComplete="email"
            className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-forest transition placeholder:text-muted focus:border-teal focus:ring-4 focus:ring-teal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            name="email"
            required
            type="email"
          />
        </label>

        <label className="block text-sm font-semibold text-forest">
          Password
          <input
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-forest transition placeholder:text-muted focus:border-teal focus:ring-4 focus:ring-teal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            minLength={mode === "register" ? 12 : undefined}
            name="password"
            required
            type="password"
          />
        </label>

        {error && (
          <p
            aria-live="polite"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-900"
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          className="w-full rounded-xl bg-forest px-4 py-3.5 font-semibold text-white transition-colors hover:bg-emerald disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
          disabled={submitting}
          type="submit"
        >
          {submitting
            ? "Working…"
            : mode === "register"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
    </div>
  );
}
