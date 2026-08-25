import { InviteMemberForm } from "@/components/invite-member-form";

export default function TeamPage() {
  return <main className="mx-auto max-w-5xl px-6 py-12"><p className="text-sm font-semibold text-emerald-700">ORGANISATION</p><h1 className="mt-2 text-3xl font-semibold">Team members</h1><section className="mt-8 rounded-xl border p-6"><h2 className="font-semibold">Invite a member</h2><p className="mt-1 text-sm text-slate-600">Role permissions are enforced by the backend for every request.</p><InviteMemberForm /></section></main>;
}
