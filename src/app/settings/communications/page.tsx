import { AppShell } from "@/components/app-shell";
import { CommunicationChannelSettings } from "@/components/communication-channel-settings";

export default function CommunicationSettingsPage() {
  return (
    <AppShell eyebrow="ORGANISATION SETTINGS" size="medium" subTabs="settings" title="Communications">
      <CommunicationChannelSettings />
    </AppShell>
  );
}
