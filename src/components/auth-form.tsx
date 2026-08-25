"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function AuthForm({ mode }: { mode: "register" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Unable to continue.");
    router.push(mode === "register" ? "/onboarding" : "/dashboard");
    router.refresh();
  }
  return <form className="mt-8 space-y-4" onSubmit={submit}>
    {mode === "register" && <label className="block text-sm font-medium">Name<input className="mt-1 w-full rounded border p-3" name="displayName" required /></label>}
    <label className="block text-sm font-medium">Email<input className="mt-1 w-full rounded border p-3" name="email" type="email" required /></label>
    <label className="block text-sm font-medium">Password<input className="mt-1 w-full rounded border p-3" name="password" type="password" minLength={mode === "register" ? 12 : undefined} required /></label>
    {error && <p className="text-sm text-red-700">{error}</p>}
    <button className="w-full rounded bg-slate-950 p-3 font-semibold text-white">{mode === "register" ? "Create account" : "Sign in"}</button>
  </form>;
}
