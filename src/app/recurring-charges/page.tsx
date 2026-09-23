import { AppShell } from "@/components/app-shell";
import { RecurringChargeWorkspace } from "@/components/recurring-charge-workspace";

export default function RecurringChargesPage() {
  return (
    <AppShell
      description="Manage recurring lease charges, generated obligations, variable amounts and waivers."
      eyebrow="RENT COLLECTION"
      title="Recurring charges"
    >
      <RecurringChargeWorkspace />
    </AppShell>
  );
}
