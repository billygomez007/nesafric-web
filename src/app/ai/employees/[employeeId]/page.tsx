import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AIEmployeeWorkspace } from "@/components/ai-employee-workspace";

export default async function AIEmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
  return <AppShell description="Review scope, tools, approvals, conversations and activity for this AI employee." eyebrow="AI WORKFORCE" subTabs="ai" title="Employee workspace"><div className="mb-5"><Link className="text-sm font-semibold text-forest transition hover:text-teal" href="/ai/employees">← Back to employees</Link></div><AIEmployeeWorkspace employeeId={(await params).employeeId} /></AppShell>;
}
