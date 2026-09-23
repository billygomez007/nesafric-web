"use client";

import { FormEvent, useState } from "react";

export function InviteMemberForm() {
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setMessage("Choose an organisation before inviting team members.");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/organisations/${organisationId}/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), roleKey: form.get("roleKey") }) });
    setMessage(response.ok ? "Invitation created." : (await response.json()).error?.message ?? "Unable to invite member.");
  }
  return <form className="mt-6 grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end" onSubmit={submit}>
    <label className="grid gap-1 text-sm font-medium text-forest">Email address<input className="rounded-xl border border-hairline bg-warm-white p-3 text-sm focus:border-teal focus:ring-2 focus:ring-teal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" name="email" placeholder="colleague@example.com" type="email" required /></label>
    <label className="grid gap-1 text-sm font-medium text-forest">Role<select className="rounded-xl border border-hairline bg-warm-white p-3 text-sm text-forest focus:border-teal focus:ring-2 focus:ring-teal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" name="roleKey"><option value="property_manager">Property manager</option><option value="viewer">Viewer</option></select></label>
    <button className="rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-emerald">Send invitation</button>
    {message && <p className="rounded-xl bg-surface p-3 text-sm text-muted sm:col-span-3">{message}</p>}
  </form>;
}
