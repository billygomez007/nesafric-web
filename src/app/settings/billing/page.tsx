import { AppShell } from "@/components/app-shell";
import { BillingSettings } from "@/components/billing-settings";

export default function BillingSettingsPage() {
  return (
    <AppShell eyebrow="BILLING" size="medium" subTabs="settings" title="Billing & subscription">
      <BillingSettings />
    </AppShell>
  );
}
