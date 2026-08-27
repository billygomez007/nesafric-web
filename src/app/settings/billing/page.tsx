import { AppShell } from "@/components/app-shell";
import { BillingSettings } from "@/components/billing-settings";

export default function BillingSettingsPage() {
  return (
    <AppShell eyebrow="ORGANISATION SETTINGS" size="medium" subTabs="settings" title="Billing">
      <BillingSettings />
    </AppShell>
  );
}
