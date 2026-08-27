import { AppShell } from "@/components/app-shell";
import { IntegrationSettings } from "@/components/integration-settings";

export default function IntegrationSettingsPage() {
  return (
    <AppShell eyebrow="ORGANISATION SETTINGS" size="medium" subTabs="settings" title="Integrations">
      <IntegrationSettings />
    </AppShell>
  );
}
