import Link from "next/link";
import { AIEmployeeDirectory } from "@/components/ai-employee-directory";

export default function AIEmployeesPage() {
  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8 flex flex-wrap justify-between gap-4"><div><p className="text-sm font-semibold text-emerald-700">PROPERTYOS AI</p><h1 className="mt-1 text-3xl font-semibold">AI Employees</h1><p className="mt-2 max-w-2xl text-slate-600">Create bounded AI receptionists and property managers for your organisation.</p></div><Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/ai">AI workspace</Link></header><AIEmployeeDirectory /></main>;
}
