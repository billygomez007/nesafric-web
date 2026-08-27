import { AppShell } from "@/components/app-shell";
import { InviteMemberForm } from "@/components/invite-member-form";

export default function TeamPage() {
  return (
    <AppShell eyebrow="ORGANISATION" size="medium" title="Team members">
      <section className="rounded-xl border p-6">
        <h2 className="font-semibold">Invite a member</h2>
        <p className="mt-1 text-sm text-slate-600">Role permissions are enforced by the backend for every request.</p>
        <InviteMemberForm />
      </section>
    </AppShell>
  );
}
