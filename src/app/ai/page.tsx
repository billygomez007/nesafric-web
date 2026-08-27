import { AppShell } from "@/components/app-shell";
import { AIPropertyManager } from "@/components/ai-property-manager";

export default function AIWorkspacePage() {
  return (
    <AppShell
      description="Review organisation-scoped operational signals, ask for deterministic summaries, and approve proposed actions."
      eyebrow="PROPERTYOS AI"
      subTabs="ai"
      title="AI property manager"
    >
      <AIPropertyManager />
    </AppShell>
  );
}
