import { AppShell } from "@/components/app-shell";
import { ReminderSettings } from "@/components/reminder-settings";

export default function ReminderSettingsPage() {
  return (
    <AppShell
      description="Manage future reminder thresholds and delivery channels. Existing notification history remains unchanged."
      eyebrow="ORGANISATION SETTINGS"
      size="medium"
      subTabs="settings"
      title="Lease-expiry reminders"
    >
      <ReminderSettings />
    </AppShell>
  );
}
