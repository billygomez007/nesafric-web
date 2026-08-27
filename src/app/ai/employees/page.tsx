import { AppShell } from "@/components/app-shell";
import { AIEmployeeDirectory } from "@/components/ai-employee-directory";

export default function AIEmployeesPage() {
  return (
    <AppShell
      description="Create bounded AI receptionists and property managers for your organisation."
      eyebrow="PROPERTYOS AI"
      subTabs="ai"
      title="AI Employees"
    >
      <AIEmployeeDirectory />
    </AppShell>
  );
}
