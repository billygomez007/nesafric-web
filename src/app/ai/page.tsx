import { AppShell } from "@/components/app-shell";
import { AIPropertyManager } from "@/components/ai-property-manager";

export default function AIWorkspacePage() {
  return (
    <AppShell
      description="Deploy bounded AI employees across your real-estate operations, with clear controls and human oversight."
      eyebrow="AI WORKFORCE"
      subTabs="ai"
      title="Your AI workforce"
    >
      <AIPropertyManager />
    </AppShell>
  );
}
