import Link from "next/link";
import { AIEmployeeWorkspace } from "@/components/ai-employee-workspace";

export default async function AIEmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><div className="mb-6"><Link className="text-sm font-semibold text-emerald-700" href="/ai/employees">← AI Employees</Link></div><AIEmployeeWorkspace employeeId={(await params).employeeId} /></main>;
}
