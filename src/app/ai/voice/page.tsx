import { AppShell } from "@/components/app-shell";
import { PropertyOsVoiceWorkspace } from "@/components/propertyos-voice-workspace";

export default function AIVoicePage() {
  return (
    <AppShell
      description="Inbound/outbound AI voice calls, transcripts, provider settings, and analytics."
      eyebrow="PROPERTYOS AI"
      subTabs="ai"
      title="Voice"
    >
      <PropertyOsVoiceWorkspace />
    </AppShell>
  );
}
