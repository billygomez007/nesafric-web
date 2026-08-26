import Link from "next/link";
import { AIAutonomyCenter } from "@/components/ai-autonomy-center";

export default function AIAutonomyPage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">PROPERTYOS AI</p>
          <h1 className="mt-1 text-3xl font-semibold">Autonomy and activity</h1>
          <p className="mt-2 max-w-2xl text-slate-600">Configure bounded operational autonomy and review every deterministic decision.</p>
        </div>
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/ai">AI conversations</Link>
      </header>
      <AIAutonomyCenter />
    </main>
  );
}
