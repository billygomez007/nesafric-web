"use client";

import { type FormEvent, useEffect, useState } from "react";

type Member = { id: string; role: string; status: string; user: { displayName: string; email: string } };

export function MarketplaceTeamManager({ professionalId }: { professionalId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch(`/api/marketplace-professionals/${professionalId}`);
    const body = await response.json();
    if (response.ok) setMembers(body.members);
    else setError(body.error?.message ?? "Unable to load the team.");
  }

  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setMembers(body.members);
      else setError(body.error?.message ?? "Unable to load the team.");
    });
  }, [professionalId]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/members`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to add that member.");
    setNotice("Member added."); (event.target as HTMLFormElement).reset();
    await load();
  }

  async function updateRole(memberId: string, role: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/members/${memberId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update that member.");
    await load();
  }

  async function updateStatus(memberId: string, status: string) {
    setError(""); setNotice("");
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/members/${memberId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error?.message ?? "Unable to update that member.");
    setNotice(status === "ACTIVE" ? "Member reactivated." : "Member deactivated.");
    await load();
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;

  return (
    <div className="grid gap-6">
      {notice && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Add a team member</h2>
        <p className="mt-1 text-sm text-slate-600">The person must already have a UmoAfric account (they register once, for both sides of UmoAfric).</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={addMember}>
          <input className="rounded border p-2 text-sm" name="email" placeholder="agent@example.com" required type="email" />
          <select className="rounded border p-2 text-sm" name="role">
            <option value="AGENT">Agent</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">Add</button>
        </form>
      </section>
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Team</h2>
        {!members ? <p className="mt-3 text-sm text-slate-500">Loading…</p> : (
          <ul className="mt-3 divide-y">
            {members.map((member) => (
              <li className="flex items-center justify-between py-3" key={member.id}>
                <div>
                  <p className="font-medium">{member.user.displayName}</p>
                  <p className="text-sm text-slate-500">{member.user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select className="rounded border p-1.5 text-sm" defaultValue={member.role} disabled={member.status !== "ACTIVE"} onChange={(event) => void updateRole(member.id, event.target.value)}>
                    <option value="OWNER">Owner</option>
                    <option value="ADMIN">Admin</option>
                    <option value="AGENT">Agent</option>
                  </select>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${member.status === "ACTIVE" ? "bg-slate-100 text-slate-700" : "bg-red-50 text-red-700"}`}>{member.status}</span>
                  {member.status === "ACTIVE" && member.role !== "OWNER" && (
                    <button className="text-xs font-semibold text-red-600 hover:text-red-800" onClick={() => void updateStatus(member.id, "SUSPENDED")} type="button">Deactivate</button>
                  )}
                  {member.status === "SUSPENDED" && (
                    <button className="text-xs font-semibold text-emerald-700 hover:text-emerald-900" onClick={() => void updateStatus(member.id, "ACTIVE")} type="button">Reactivate</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
