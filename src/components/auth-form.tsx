"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { trackEvent } from "@/platform/analytics";

export function AuthForm({ mode }: { mode: "register" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A login (unlike registration) has no server-side uniqueness guard against a second
    // concurrent request also succeeding — guard here so a double-click can't double-fire sign_up/login.
    if (submitting) return;
    setSubmitting(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    if (!response.ok) {
      setSubmitting(false);
      return setError((await response.json()).error?.message ?? "Unable to continue.");
    }
    trackEvent(mode === "register" ? "sign_up" : "login", { method: "email" });
    router.push(mode === "register" ? "/onboarding" : "/dashboard");
    router.refresh();
  }
  return <form className="mt-8 space-y-4" onSubmit={submit}>
    {mode === "register" && <label className="block text-sm font-medium">Name<input className="mt-1 w-full rounded border p-3" name="displayName" required /></label>}
    <label className="block text-sm font-medium">Email<input className="mt-1 w-full rounded border p-3" name="email" type="email" required /></label>
    <label className="block text-sm font-medium">Password<input className="mt-1 w-full rounded border p-3" name="password" type="password" minLength={mode === "register" ? 12 : undefined} required /></label>
    {error && <p className="text-sm text-red-700">{error}</p>}
    <button className="w-full rounded bg-brand p-3 font-semibold text-navy transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={submitting}>{mode === "register" ? "Create account" : "Sign in"}</button>
  </form>;
}
