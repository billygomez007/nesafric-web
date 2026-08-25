import Link from "next/link";
import { DashboardContent } from "@/components/dashboard-content";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="flex items-center justify-between"><div><p className="text-sm font-semibold text-emerald-700">PROPERTYOS AI</p><h1 className="text-3xl font-semibold">Organisation dashboard</h1></div><Link className="rounded bg-slate-950 px-4 py-2 font-semibold text-white" href="/properties/new">Add property</Link></header>
      <DashboardContent />
    </main>
  );
}
