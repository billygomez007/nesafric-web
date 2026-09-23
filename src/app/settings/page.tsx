import { AppShell } from "@/components/app-shell";
import { AccountSettings } from "@/components/account-settings";

export default function SettingsPage() {
  return (
    <AppShell
      eyebrow="ACCOUNT SETTINGS"
      title="Profile & account"
      description="Manage your personal profile, email, password and account access."
      size="medium"
      subTabs="settings"
    >
      <AccountSettings />
    </AppShell>
  );
}
