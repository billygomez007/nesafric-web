import { AppShell } from "@/components/app-shell";
import { LeaseForm } from "@/components/lease-form";

export default function NewLeasePage() {
  return (
    <AppShell
      description="Choose a property and optional unit, then assign one or more organisation-scoped tenant records."
      eyebrow="LEASING"
      size="narrow"
      title="Create lease"
    >
      <LeaseForm />
    </AppShell>
  );
}
