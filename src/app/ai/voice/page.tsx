import { AppShell } from "@/components/app-shell";
import { PropertyOsVoiceWorkspace } from "@/components/propertyos-voice-workspace";

export default function AIVoicePage() {
  return (
    <AppShell
      description="Voice calling is deferred while the communication foundation remains available for configured call records."
      eyebrow="AI WORKFORCE"
      subTabs="ai"
      title="Voice · Deferred"
    >
      <PropertyOsVoiceWorkspace />
    </AppShell>
  );
}
