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
  return <form className="mt-4 flex gap-3" onSubmit={submit}>
    <input className="flex-1 rounded border p-3" name="email" placeholder="colleague@example.com" type="email" required />
    <select className="rounded border p-3" name="roleKey"><option value="property_manager">Property manager</option><option value="viewer">Viewer</option></select>
    <button className="rounded bg-slate-950 px-4 font-semibold text-white">Invite</button>
    {message && <p className="self-center text-sm text-slate-600">{message}</p>}
  </form>;
}
