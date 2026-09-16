"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { trackEvent } from "@/platform/analytics";

type Workspaces = {
  propertyOsOrganisations: Array<{ id: string; name: string }>;
  marketplaceProfessionals: Array<{ id: string; displayName: string }>;
};

export function AuthForm({ mode }: { mode: "register" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resolveWorkspace(workspaces: Partial<Workspaces> | undefined) {
    if (!workspaces || !Array.isArray(workspaces.propertyOsOrganisations) || !Array.isArray(workspaces.marketplaceProfessionals)) return "/dashboard";
    const organisation = workspaces.propertyOsOrganisations[0];
    if (organisation) {
      localStorage.setItem("propertyos.activeOrganisationId", organisation.id);
      return "/dashboard";
    }
    const professional = workspaces.marketplaceProfessionals[0];
    if (professional) {
      localStorage.setItem("nesafric.activeMarketplaceProfessionalId", professional.id);
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
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to continue.");
      trackEvent(mode === "register" ? "sign_up" : "login", { method: "email" });
      const destination = mode === "register" ? "/onboarding" : resolveWorkspace(body.workspaces);
      router.push(destination);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to continue.");
      setSubmitting(false);
    }
  }

  return <form className="mt-8 space-y-5" onSubmit={submit}>
    {mode === "register" && <label className="block text-sm font-semibold text-forest">Name<input autoComplete="name" className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-forest transition placeholder:text-muted focus:border-teal focus:ring-4 focus:ring-teal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal" name="displayName" required /></label>}
    <label className="block text-sm font-semibold text-forest">Email<input autoComplete="email" className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-forest transition placeholder:text-muted focus:border-teal focus:ring-4 focus:ring-teal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal" name="email" type="email" required /></label>
    <label className="block text-sm font-semibold text-forest">Password<input autoComplete={mode === "register" ? "new-password" : "current-password"} className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-forest transition placeholder:text-muted focus:border-teal focus:ring-4 focus:ring-teal/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal" name="password" type="password" minLength={mode === "register" ? 12 : undefined} required /></label>
    {error && <p aria-live="polite" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-900" role="alert">{error}</p>}
    <button className="w-full rounded-xl bg-forest px-4 py-3.5 font-semibold text-white transition-colors hover:bg-emerald disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={submitting} type="submit">{submitting ? "Working…" : mode === "register" ? "Create account" : "Sign in"}</button>
  </form>;
}
