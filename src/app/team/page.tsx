import { AppShell } from "@/components/app-shell";
import { InviteMemberForm } from "@/components/invite-member-form";

export default function TeamPage() {
  return (
    <AppShell description="Invite trusted people into the active NesAfric management workspace with backend-enforced roles." eyebrow="ORGANISATION" size="medium" title="Team & access">
      <section className="rounded-3xl border border-hairline bg-white p-6 shadow-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">TEAM MANAGEMENT</p><h2 className="mt-2 text-2xl font-semibold text-forest">Invite a teammate</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Invitations are tied to this active organisation. The selected role controls access through the existing RBAC policy and can never grant more access than the backend permits.</p>
        <InviteMemberForm />
      </section>
      <section className="mt-6 rounded-3xl border border-gold/30 bg-cream p-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">WORKSPACE CONTROL</p><h2 className="mt-2 text-xl font-semibold text-forest">Managing the active organisation</h2><p className="mt-2 text-sm leading-6 text-muted">Use the workspace switcher in the app header to move between your NesAfric management organisations and separate Marketplace Professional profiles. Those workspaces keep their own membership and permissions.</p></section>
    </AppShell>
  );
}
