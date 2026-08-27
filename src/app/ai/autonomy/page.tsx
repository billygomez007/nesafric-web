import { AppShell } from "@/components/app-shell";
import { AIAutonomyCenter } from "@/components/ai-autonomy-center";

export default function AIAutonomyPage() {
  return (
    <AppShell
      description="Configure bounded operational autonomy and review every deterministic decision."
      eyebrow="PROPERTYOS AI"
      subTabs="ai"
      title="Autonomy and activity"
    >
      <AIAutonomyCenter />
    </AppShell>
  );
}
